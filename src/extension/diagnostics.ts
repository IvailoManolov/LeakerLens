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
