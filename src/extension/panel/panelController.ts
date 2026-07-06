import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import type { Severity } from '../../engine';
import type { ScanController } from '../scanController';
import { applyRemediation } from '../remediation';
import type {
  HostToPanel,
  Locator,
  PanelFinding,
  PanelState,
  PanelToHost,
  PanelView,
  RemediationKind,
  SafeGroup,
  SeverityGroup,
  TreeFileNode,
  TreeOccurrence,
  TreeSecretNode,
  TreeState,
} from './protocol';
import type { Finding } from '../../engine';

const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low'];

/** Flatten a {@link Finding} into a {@link PanelFinding}, optionally flagged `safe`. */
function toPanelFinding(uriStr: string, file: string, f: Finding, safe = false): PanelFinding {
  return {
    loc: { uri: uriStr, start: f.start, end: f.end },
    ruleName: f.ruleName,
    severity: f.severity,
    file,
    line: f.line + 1,
    preview: f.matchPreview,
    message: f.message,
    // Safe findings (gitignored `.env`) live exactly where they belong — there is nothing to
    // mask, move, or ignore — so they carry no remediations and the panel shows no action links.
    remediations: safe ? [] : f.remediations.map((r) => ({ kind: r.kind, title: r.title })),
    ...(safe ? { safe: true } : {}),
  };
}

/**
 * Group findings by engine fingerprint (same raw value → same node), then by file, into
 * sorted {@link TreeSecretNode}s. `safe` tags every node and shifts the sort. Single O(F) pass.
 */
function buildSecretNodes(
  byUri: ReadonlyMap<string, Finding[]>,
  safe: boolean,
): { secrets: TreeSecretNode[]; totalRefs: number } {
  interface Group {
    ruleName: string;
    severity: Severity;
    preview: string;
    total: number;
    files: Map<string, TreeOccurrence[]>;
  }
  const byFingerprint = new Map<string, Group>();
  let totalRefs = 0;

  for (const [uriStr, findings] of byUri) {
    if (findings.length === 0) {
      continue;
    }
    const file = vscode.workspace.asRelativePath(vscode.Uri.parse(uriStr));
    for (const f of findings) {
      totalRefs += 1;
      let group = byFingerprint.get(f.fingerprint);
      if (!group) {
        group = {
          ruleName: f.ruleName,
          severity: f.severity,
          preview: f.matchPreview,
          total: 0,
          files: new Map(),
        };
        byFingerprint.set(f.fingerprint, group);
      }
      group.total += 1;
      const occurrence: TreeOccurrence = {
        loc: { uri: uriStr, start: f.start, end: f.end },
        line: f.line + 1,
        column: f.column + 1,
      };
      const bucket = group.files.get(file) ?? [];
      bucket.push(occurrence);
      group.files.set(file, bucket);
    }
  }

  const secrets: TreeSecretNode[] = [];
  for (const [fingerprint, group] of byFingerprint) {
    const files: TreeFileNode[] = [...group.files.entries()]
      .map(([file, occurrences]) => ({ file, count: occurrences.length, occurrences }))
      .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
    secrets.push({
      fingerprint,
      ruleName: group.ruleName,
      severity: group.severity,
      preview: group.preview,
      totalCount: group.total,
      fileCount: files.length,
      files,
      ...(safe ? { safe: true } : {}),
    });
  }
  // Problem nodes sort by severity first; safe nodes share one group and sort by count/name.
  secrets.sort(
    safe
      ? (a, b) => b.totalCount - a.totalCount || a.ruleName.localeCompare(b.ruleName)
      : (a, b) =>
          SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
          b.totalCount - a.totalCount ||
          a.ruleName.localeCompare(b.ruleName),
  );
  return { secrets, totalRefs };
}

/**
 * Host side of the findings panel. Implements the webview message protocol: pushes
 * {@link PanelState} on every scan update and handles {@link PanelToHost} actions.
 */
export class PanelController implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'leakerlens.panel';

  private view: vscode.WebviewView | undefined;
  private scanning = false;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly log: vscode.OutputChannel;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: ScanController,
  ) {
    this.log = vscode.window.createOutputChannel('LeakerLens');
    this.disposables.push(this.log);
    this.disposables.push(controller.onDidUpdate(() => this.push()));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.log.appendLine('resolveWebviewView: wiring panel webview');
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage(
      (message: PanelToHost) => void this.onMessage(message),
      undefined,
      this.disposables,
    );
  }

  /** Toggle the scanning indicator (used by the workspace scan command). */
  setScanning(scanning: boolean): void {
    this.scanning = scanning;
    this.push();
  }

  /** Ask the webview to switch to a given view (used by the Show Secret Graph command). */
  setView(view: PanelView): void {
    if (!this.view) {
      return;
    }
    const message: HostToPanel = { type: 'setView', view };
    void this.view.webview.postMessage(message);
  }

  private push(): void {
    if (!this.view) {
      return;
    }
    const message: HostToPanel = { type: 'state', payload: this.buildState() };
    void this.view.webview.postMessage(message);
  }

  private buildState(): PanelState {
    const grouped = new Map<Severity, PanelFinding[]>();
    let total = 0;
    for (const [uriStr, findings] of this.controller.allCountableFindings()) {
      if (findings.length === 0) {
        continue;
      }
      const file = vscode.workspace.asRelativePath(vscode.Uri.parse(uriStr));
      for (const f of findings) {
        total += 1;
        const item = toPanelFinding(uriStr, file, f);
        const bucket = grouped.get(f.severity) ?? [];
        bucket.push(item);
        grouped.set(f.severity, bucket);
      }
    }
    const groups: SeverityGroup[] = SEVERITY_ORDER.filter((s) => grouped.has(s)).map((severity) => {
      const items = grouped.get(severity) ?? [];
      return { severity, count: items.length, items };
    });

    // Safe set: secrets in gitignored `.env` files — rendered green, never part of the count.
    const safeItems: PanelFinding[] = [];
    for (const [uriStr, findings] of this.controller.allSafeFindings()) {
      if (findings.length === 0) {
        continue;
      }
      const file = vscode.workspace.asRelativePath(vscode.Uri.parse(uriStr));
      for (const f of findings) {
        safeItems.push(toPanelFinding(uriStr, file, f, true));
      }
    }
    const safeCount = safeItems.length;
    const safeGroup: SafeGroup | undefined =
      safeCount > 0 ? { count: safeCount, items: safeItems } : undefined;

    return {
      groups,
      tree: this.buildTree(),
      totalCount: total,
      isEmpty: total === 0 && safeCount === 0,
      scanning: this.scanning,
      ...(safeGroup ? { safeGroup } : {}),
    };
  }

  /**
   * Build the "where is each secret referenced from" tree. Both the countable (problem) set
   * and the safe (gitignored `.env`) set are folded in: problem nodes come first, then safe
   * nodes flagged via {@link TreeSecretNode.safe}. The `total*` counts cover problems only;
   * safe ones are tallied separately in `safe*`. The raw secret never leaves the host — only
   * the masked preview and fingerprint travel out.
   */
  private buildTree(): TreeState {
    const problem = buildSecretNodes(this.controller.allCountableFindings(), false);
    const safe = buildSecretNodes(this.controller.allSafeFindings(), true);
    return {
      secrets: [...problem.secrets, ...safe.secrets],
      totalSecrets: problem.secrets.length,
      totalRefs: problem.totalRefs,
      ...(safe.secrets.length > 0
        ? { safeSecrets: safe.secrets.length, safeRefs: safe.totalRefs }
        : {}),
    };
  }

  private async onMessage(message: PanelToHost): Promise<void> {
    this.log.appendLine(`recv: ${message.type}`);
    switch (message.type) {
      case 'ready':
        this.push();
        return;
      case 'rescan':
        await vscode.commands.executeCommand('leakerlens.scanWorkspace');
        return;
      case 'jumpTo':
        await this.jumpTo(message.loc);
        return;
      case 'remediate':
        await this.remediate(message.loc, message.kind);
        return;
      case 'log':
        this.log.appendLine(`webview: ${message.text}`);
        return;
    }
  }

  private async jumpTo(loc: Locator): Promise<void> {
    try {
      const uri = vscode.Uri.parse(loc.uri);
      this.log.appendLine(`jumpTo: ${uri.toString()} [${loc.start}, ${loc.end}]`);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      const range = new vscode.Range(doc.positionAt(loc.start), doc.positionAt(loc.end));
      editor.selection = new vscode.Selection(range.start, range.end);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    } catch (err) {
      this.log.appendLine(`jumpTo error: ${(err as Error).message}`);
      void vscode.window.showErrorMessage(`LeakerLens: couldn't open the file — ${(err as Error).message}`);
    }
  }

  private async remediate(loc: Locator, kind: RemediationKind): Promise<void> {
    try {
      const uri = vscode.Uri.parse(loc.uri);
      this.log.appendLine(`remediate ${kind}: ${uri.toString()} [${loc.start}, ${loc.end}]`);
      const doc = await vscode.workspace.openTextDocument(uri);
      const line = doc.positionAt(loc.start).line;
      await applyRemediation({ uri: loc.uri, start: loc.start, end: loc.end, line, kind }, this.controller);
    } catch (err) {
      this.log.appendLine(`remediate error: ${(err as Error).message}`);
      void vscode.window.showErrorMessage(`LeakerLens: couldn't apply "${kind}" — ${(err as Error).message}`);
    }
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('hex');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.css'));
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource}`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
  </head>
  <body class="text-base text-fg">
    <div id="app" class="flex flex-col h-full"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
