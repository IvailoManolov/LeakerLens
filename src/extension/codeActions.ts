import * as vscode from 'vscode';
import type { ScanController } from './scanController';
import type { RemediationArg } from './remediation';

/** Lightbulb quick-fixes for findings under the cursor/selection. */
export class LeakCodeActionProvider implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  constructor(private readonly controller: ScanController) {}

  provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
    const start = document.offsetAt(range.start);
    const end = document.offsetAt(range.end);
    const actions: vscode.CodeAction[] = [];

    for (const finding of this.controller.getFindings(document.uri)) {
      // Offer fixes when the selection/cursor touches the finding's span.
      if (start > finding.end || end < finding.start) {
        continue;
      }
      const line = document.positionAt(finding.start).line;
      for (const remediation of finding.remediations) {
        const action = new vscode.CodeAction(
          `LeakLens: ${remediation.title}`,
          vscode.CodeActionKind.QuickFix,
        );
        const arg: RemediationArg = {
          uri: document.uri.toString(),
          start: finding.start,
          end: finding.end,
          line,
          kind: remediation.kind,
        };
        action.command = {
          command: 'leaklens.applyRemediation',
          title: remediation.title,
          arguments: [arg],
        };
        actions.push(action);
      }
    }
    return actions;
  }
}
