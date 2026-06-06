import * as vscode from 'vscode';
import type { Finding } from '../engine';

/**
 * The decoration shown for each finding: a subtle overview-ruler mark using the theme's
 * error color (no hardcoded colors, native look). Squiggles come from diagnostics.
 */
export function createGutterDecoration(): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    overviewRulerColor: new vscode.ThemeColor('editorError.foreground'),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    isWholeLine: false,
  });
}

/** Build decoration ranges for a document's findings. */
export function toDecorationRanges(findings: readonly Finding[], doc: vscode.TextDocument): vscode.Range[] {
  return findings.map((f) => new vscode.Range(doc.positionAt(f.start), doc.positionAt(f.end)));
}
