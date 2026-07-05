import * as vscode from 'vscode';
import type { Finding } from '../engine';
import type { ScanController } from './scanController';
import type { RemediationArg } from './remediation';

/** Hover that teaches (what / why) and offers the one-click fixes as command links. */
export class LeakHoverProvider implements vscode.HoverProvider {
  constructor(private readonly controller: ScanController) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const offset = document.offsetAt(position);
    const finding = this.controller
      .getFindings(document.uri)
      .find((f) => offset >= f.start && offset <= f.end);
    if (!finding) {
      return undefined;
    }

    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;
    md.appendMarkdown(`**${finding.ruleName}**\n\n`);
    md.appendMarkdown(`${finding.message}\n\n`);
    md.appendMarkdown(`\`${finding.matchPreview}\`\n\n`);
    // Safe findings (gitignored `.env`) are where they belong — offer no mask/move/ignore links.
    if (!this.controller.isSafe(document.uri)) {
      md.appendMarkdown(actionLinks(document, finding));
    }

    const range = new vscode.Range(document.positionAt(finding.start), document.positionAt(finding.end));
    return new vscode.Hover(md, range);
  }
}

function actionLinks(document: vscode.TextDocument, finding: Finding): string {
  const line = document.positionAt(finding.start).line;
  return finding.remediations
    .map((r) => {
      const arg: RemediationArg = {
        uri: document.uri.toString(),
        start: finding.start,
        end: finding.end,
        line,
        kind: r.kind,
      };
      const encoded = encodeURIComponent(JSON.stringify([arg]));
      return `[${r.title}](command:leaklens.applyRemediation?${encoded})`;
    })
    .join(' · ');
}
