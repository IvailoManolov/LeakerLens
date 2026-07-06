import { basename } from 'path';
import * as vscode from 'vscode';
import { scanText, type Finding } from '../engine';
import { readConfig, type LeakLensConfig } from './config';
import { toDiagnostic, envExposedDiagnostic, envTrackedButIgnoredDiagnostic } from './diagnostics';
import { toDecorationRanges } from './decorations';
import { isProtectedEnvFile, EnvGitignoreClassifier } from './envFiles';
import { isInScanScope } from './scanScope';

/** How a scanned document relates to `.env` handling. */
type EnvKind = 'none' | 'safe' | 'exposed';

/**
 * Whether a document close should drop its cached findings. Findings describe the file on
 * disk, and VS Code closes background documents (e.g. those the workspace scan loaded) at its
 * own pace — clearing on every close made the panel count silently decay between rescans. Only
 * content that never reached disk (untitled, or dirty changes being discarded) goes stale.
 */
export function shouldClearOnClose(doc: vscode.TextDocument): boolean {
  return doc.isUntitled || doc.isDirty;
}

interface DocResult {
  readonly findings: Finding[];
  /** `none` = ordinary file; `safe`/`exposed` = a `.env` file (gitignored or not). */
  readonly env: EnvKind;
  /** True when the file is within workspace scan scope (not in an excluded dir). */
  readonly inScope: boolean;
}

/** The decoration types the controller paints with. */
export interface Decorations {
  /** The error-colored mark for ordinary findings. */
  readonly normal: vscode.TextEditorDecorationType;
  /** The green mark for secrets living safely inside a `.env` file. */
  readonly envSafe: vscode.TextEditorDecorationType;
}

/**
 * Owns the scan lifecycle: debounced per-document scanning, the findings cache, the
 * diagnostic collection, and editor decorations. Scanning stays off the hot path — we
 * never scan synchronously on every keystroke, only after typing settles.
 *
 * `.env` files are special-cased: their secrets are *expected*, so they render green and are
 * not counted as findings. The only risk is the file being tracked by git, which surfaces as
 * a single file-level warning when `.env` isn't gitignored.
 */
export class ScanController implements vscode.Disposable {
  private readonly results = new Map<string, DocResult>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('leaklens');
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly envClassifier = new EnvGitignoreClassifier();
  /** Fires whenever the findings cache changes (the panel listens to this). */
  readonly onDidUpdate = this.emitter.event;
  private config: LeakLensConfig;
  private inFlightScan: Promise<void> | undefined;
  /** In-flight per-document scans, keyed by URI, for same-version coalescing. */
  private readonly pendingScans = new Map<string, { version: number; promise: Promise<void> }>();

  constructor(private readonly decorations: Decorations) {
    this.config = readConfig();
  }

  /** Re-read settings; clear everything if the extension was disabled. */
  reloadConfig(): void {
    this.config = readConfig();
    if (!this.config.enable) {
      this.clearAll();
    }
  }

  getFindings(uri: vscode.Uri): Finding[] {
    return this.results.get(uri.toString())?.findings ?? [];
  }

  /**
   * True when `uri` is a gitignored `.env` file whose secrets are safe (rendered green). Such
   * findings have no applicable remediations — there is nothing to mask, move, or ignore — so
   * the editor hover and quick-fixes suppress their action links, matching the panel.
   */
  isSafe(uri: vscode.Uri): boolean {
    return this.results.get(uri.toString())?.env === 'safe';
  }

  /** Every URI's findings — including `.env` files (used for decorations/hovers). */
  allFindings(): ReadonlyMap<string, Finding[]> {
    const out = new Map<string, Finding[]>();
    for (const [uri, result] of this.results) {
      out.set(uri, result.findings);
    }
    return out;
  }

  /**
   * Only the findings that count as problems — ordinary files (`none`) and exposed `.env`
   * files, both within scan scope. Secrets inside gitignored (`safe`) `.env` files are where
   * they belong, so they're excluded from the panel and workspace totals.
   */
  allCountableFindings(): ReadonlyMap<string, Finding[]> {
    const out = new Map<string, Finding[]>();
    for (const [uri, result] of this.results) {
      if (result.inScope && (result.env === 'none' || result.env === 'exposed')) {
        out.set(uri, result.findings);
      }
    }
    return out;
  }

  /**
   * The "safe" findings — secrets living in gitignored `.env` files, within scan scope. Shown
   * green in the panel/map as a distinct set, never part of the leak count.
   */
  allSafeFindings(): ReadonlyMap<string, Finding[]> {
    const out = new Map<string, Finding[]>();
    for (const [uri, result] of this.results) {
      if (result.inScope && result.env === 'safe') {
        out.set(uri, result.findings);
      }
    }
    return out;
  }

  /**
   * Serialize full workspace scans: a second call while one runs awaits the same run, so the
   * panel 'rescan' and Show Secret Graph can't run overlapping scans against the shared cache.
   */
  runWorkspaceScan(fn: () => Promise<void>): Promise<void> {
    if (this.inFlightScan) {
      return this.inFlightScan;
    }
    // Snapshot start: drop the previous run's scope tags so deleted/renamed files fall out
    // of the report. Found files get re-tagged inScope during the scan; decorations survive.
    for (const [uri, result] of this.results) {
      if (result.inScope) {
        this.results.set(uri, { ...result, inScope: false });
      }
    }
    this.inFlightScan = fn().finally(() => {
      this.inFlightScan = undefined;
    });
    return this.inFlightScan;
  }

  /** Drop cached gitignore answers (after a `.gitignore` change). */
  invalidateEnvCache(): void {
    this.envClassifier.invalidate();
  }

  /** Queue a debounced scan of `doc`. Pass `delayOverride = 0` to scan ASAP. */
  scheduleScan(doc: vscode.TextDocument, delayOverride?: number): void {
    if (!this.shouldScan(doc)) {
      return;
    }
    const key = doc.uri.toString();
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const delay = delayOverride ?? this.config.debounceMs;
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void this.scanNow(doc);
      }, delay),
    );
  }

  /**
   * Scan `doc` immediately and update diagnostics + decorations. Resolves once the document's
   * classification is final — for `.env` files that includes the async git check — so the
   * workspace scan can await complete, classified results before tallying.
   */
  scanNow(doc: vscode.TextDocument): Promise<void> {
    if (!this.shouldScan(doc)) {
      return Promise.resolve();
    }
    // Coalesce same-version scans of the same document. The workspace scan's own
    // openTextDocument fires onDidOpenTextDocument → scheduleScan(doc, 0), whose duplicate
    // scan replaced the findings array and made applyEnvStatus's staleness check drop the
    // awaited `exposed` classification — so an exposed `.env`'s secrets went uncounted.
    const key = doc.uri.toString();
    const pending = this.pendingScans.get(key);
    if (pending && pending.version === doc.version) {
      return pending.promise;
    }
    const promise = this.doScanNow(doc).finally(() => {
      if (this.pendingScans.get(key)?.promise === promise) {
        this.pendingScans.delete(key);
      }
    });
    this.pendingScans.set(key, { version: doc.version, promise });
    return promise;
  }

  private doScanNow(doc: vscode.TextDocument): Promise<void> {
    const findings = scanText(doc.getText(), { filename: doc.fileName });
    const inScope = isInScanScope(doc.uri);

    if (!isProtectedEnvFile(doc.fileName)) {
      this.results.set(doc.uri.toString(), { findings, env: 'none', inScope });
      this.diagnostics.set(
        doc.uri,
        findings.map((f) => toDiagnostic(f, doc)),
      );
      this.refreshDecorationsFor(doc.uri);
      this.emitter.fire();
      return Promise.resolve();
    }

    // A real `.env` file: classify against git, then render green (+ warning if exposed).
    // Show it green immediately; the gitignore answer (cached after the first call) only
    // decides whether the exposed warning appears.
    this.results.set(doc.uri.toString(), { findings, env: 'safe', inScope });
    this.diagnostics.set(doc.uri, []);
    this.refreshDecorationsFor(doc.uri);
    this.emitter.fire();
    return this.applyEnvStatus(doc, findings);
  }

  private async applyEnvStatus(doc: vscode.TextDocument, findings: Finding[]): Promise<void> {
    const version = doc.version;
    const hasSecrets = findings.length > 0;
    const status = await this.envClassifier.classify(doc.fileName);
    const exposed = status === 'exposed' && hasSecrets;
    // A gitignored `.env` is green — but if it's *also* still tracked, the secrets are already in
    // git, so we keep it green yet add a quiet untrack advisory. Only worth checking when there
    // are secrets and the file isn't already flagged exposed.
    const tracked = !exposed && hasSecrets ? await this.envClassifier.isTracked(doc.fileName) : false;
    // The document may have changed (or closed) while git answered — drop stale results.
    const current = this.results.get(doc.uri.toString());
    if (!current || current.findings !== findings || doc.version !== version) {
      return;
    }
    const inScope = current.inScope;
    if (exposed) {
      // Tracked by git: per-finding red diagnostics PLUS the file-level exposed summary, and
      // these now count as problems.
      this.results.set(doc.uri.toString(), { findings, env: 'exposed', inScope });
      this.diagnostics.set(doc.uri, [
        envExposedDiagnostic(doc, findings.length),
        ...findings.map((f) => toDiagnostic(f, doc)),
      ]);
    } else {
      this.results.set(doc.uri.toString(), { findings, env: 'safe', inScope });
      this.diagnostics.set(
        doc.uri,
        tracked ? [envTrackedButIgnoredDiagnostic(doc, basename(doc.fileName))] : [],
      );
    }
    this.refreshDecorationsFor(doc.uri);
    this.emitter.fire();
  }

  /** Apply decorations to any visible editor showing `uri`. */
  refreshDecorationsFor(uri: vscode.Uri): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === uri.toString()) {
        this.refreshEditor(editor);
      }
    }
  }

  /** Apply decorations for a specific editor from cached findings. */
  refreshEditor(editor: vscode.TextEditor): void {
    const result = this.results.get(editor.document.uri.toString());
    const findings = result?.findings ?? [];
    const ranges = toDecorationRanges(findings, editor.document);
    // Only gitignored (`safe`) `.env` secrets render green; `exposed` ones use the normal/red
    // decoration like any other leak.
    const useGreen = result?.env === 'safe';
    // Paint with the matching decoration and clear the other so a file never shows both.
    editor.setDecorations(this.decorations.normal, useGreen ? [] : ranges);
    editor.setDecorations(this.decorations.envSafe, useGreen ? ranges : []);
  }

  /** Drop a document's findings (e.g. on close). */
  clear(uri: vscode.Uri): void {
    this.results.delete(uri.toString());
    this.diagnostics.delete(uri);
    this.emitter.fire();
  }

  private clearAll(): void {
    this.results.clear();
    this.diagnostics.clear();
    this.emitter.fire();
  }

  private shouldScan(doc: vscode.TextDocument): boolean {
    if (!this.config.enable) {
      return false;
    }
    if (doc.uri.scheme !== 'file') {
      return false;
    }
    return Buffer.byteLength(doc.getText(), 'utf8') <= this.config.maxFileSizeBytes;
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.diagnostics.dispose();
    this.emitter.dispose();
  }
}
