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

/**
 * The decoration for a secret living safely inside a `.env` file: a calm green overview-ruler
 * mark and underline meaning "this is where secrets belong". VS Code has no themable *green
 * squiggle* token, so the underline color is a fixed calm green (with light/dark variants) —
 * the only hardcoded color, since no theme variable exists for it.
 */
export function createEnvSafeDecoration(): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    overviewRulerColor: new vscode.ThemeColor('charts.green'),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    isWholeLine: false,
    light: { textDecoration: 'underline wavy #2da44e' },
    dark: { textDecoration: 'underline wavy #3fb950' },
  });
}

/** Build decoration ranges for a document's findings. */
export function toDecorationRanges(findings: readonly Finding[], doc: vscode.TextDocument): vscode.Range[] {
  return findings.map((f) => new vscode.Range(doc.positionAt(f.start), doc.positionAt(f.end)));
}
