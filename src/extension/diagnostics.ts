import * as vscode from 'vscode';
import type { Finding, Severity } from '../engine';

/** Map our severity to VS Code's diagnostic severity (calm, not alarmist). */
const SEVERITY_MAP: Record<Severity, vscode.DiagnosticSeverity> = {
  critical: vscode.DiagnosticSeverity.Error,
  high: vscode.DiagnosticSeverity.Error,
  medium: vscode.DiagnosticSeverity.Warning,
  low: vscode.DiagnosticSeverity.Information,
};

/** Convert a {@link Finding} into a VS Code diagnostic, using precise offsets. */
export function toDiagnostic(finding: Finding, doc: vscode.TextDocument): vscode.Diagnostic {
  const range = new vscode.Range(doc.positionAt(finding.start), doc.positionAt(finding.end));
  const diagnostic = new vscode.Diagnostic(range, finding.message, SEVERITY_MAP[finding.severity]);
  diagnostic.source = 'LeakLens';
  diagnostic.code = finding.ruleId;
  return diagnostic;
}

/** Diagnostic code that marks the "this .env file isn't gitignored" warning. */
export const ENV_EXPOSED_CODE = 'env-not-gitignored';

/**
 * The single file-level warning shown on a `.env` file that git would commit. The secrets
 * inside are fine where they are — the risk is the file itself being tracked — so this is one
 * warning on the first line, not one per secret. Its {@link ENV_EXPOSED_CODE} lets the
 * code-action provider attach the "Add to .gitignore" quick-fix.
 */
export function envExposedDiagnostic(doc: vscode.TextDocument, secretCount: number): vscode.Diagnostic {
  const range = doc.lineAt(0).range;
  const plural = secretCount === 1 ? 'secret' : 'secrets';
  const diagnostic = new vscode.Diagnostic(
    range,
    `⚠ This .env file isn't in .gitignore — ${secretCount} ${plural} will be committed to git.`,
    vscode.DiagnosticSeverity.Warning,
  );
  diagnostic.source = 'LeakLens';
  diagnostic.code = ENV_EXPOSED_CODE;
  return diagnostic;
}

/** Diagnostic code that marks the "gitignored but still tracked" advisory. */
export const ENV_TRACKED_CODE = 'env-tracked-but-ignored';

/**
 * A gentle, Information-level advisory for a `.env` that is gitignored *and still tracked* by git.
 * The secrets are safe going forward (the panel shows them green and they're not counted), but the
 * file is already in git's index/history, so this nudges the user to untrack it. Not a leak count.
 */
export function envTrackedButIgnoredDiagnostic(doc: vscode.TextDocument, name: string): vscode.Diagnostic {
  const range = doc.lineAt(0).range;
  const diagnostic = new vscode.Diagnostic(
    range,
    `This .env is gitignored, but still tracked by git — run "git rm --cached ${name}" to stop committing it.`,
    vscode.DiagnosticSeverity.Information,
  );
  diagnostic.source = 'LeakLens';
  diagnostic.code = ENV_TRACKED_CODE;
  return diagnostic;
}
