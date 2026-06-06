import * as vscode from 'vscode';
import { scanText, type Finding } from '../engine';
import { readConfig, type LeakLensConfig } from './config';
import { toDiagnostic } from './diagnostics';
import { toDecorationRanges } from './decorations';

/**
 * Owns the scan lifecycle: debounced per-document scanning, the findings cache, the
 * diagnostic collection, and editor decorations. Scanning stays off the hot path — we
 * never scan synchronously on every keystroke, only after typing settles.
 */
export class ScanController implements vscode.Disposable {
  private readonly findings = new Map<string, Finding[]>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('leaklens');
  private readonly emitter = new vscode.EventEmitter<void>();
  /** Fires whenever the findings cache changes (the panel listens to this). */
  readonly onDidUpdate = this.emitter.event;
  private config: LeakLensConfig;

  constructor(private readonly decorationType: vscode.TextEditorDecorationType) {
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
    return this.findings.get(uri.toString()) ?? [];
  }

  allFindings(): ReadonlyMap<string, Finding[]> {
    return this.findings;
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
        this.scanNow(doc);
      }, delay),
    );
  }

  /** Scan `doc` immediately and update diagnostics + decorations. */
  scanNow(doc: vscode.TextDocument): void {
    if (!this.shouldScan(doc)) {
      return;
    }
    const findings = scanText(doc.getText(), { filename: doc.fileName });
    this.findings.set(doc.uri.toString(), findings);
    this.diagnostics.set(
      doc.uri,
      findings.map((f) => toDiagnostic(f, doc)),
    );
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
    editor.setDecorations(
      this.decorationType,
      toDecorationRanges(this.getFindings(editor.document.uri), editor.document),
    );
  }

  /** Drop a document's findings (e.g. on close). */
  clear(uri: vscode.Uri): void {
    this.findings.delete(uri.toString());
    this.diagnostics.delete(uri);
    this.emitter.fire();
  }

  private clearAll(): void {
    this.findings.clear();
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
