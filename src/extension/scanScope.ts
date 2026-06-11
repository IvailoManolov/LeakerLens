import * as vscode from 'vscode';

/**
 * Directories excluded from workspace scanning — must mirror EXCLUDED_DIRS below. These are the
 * gitignored build/output/sandbox dirs; scanning them pulls in generated files (e.g. the compiled
 * test suite in `out-test/`, full of fixture secrets) whose presence varies between runs, which
 * is what made repeated scans report different counts.
 */
export const SCAN_EXCLUDE =
  '**/{node_modules,.git,dist,out,out-test,build,.vscode-test,coverage,.sandbox}/**';
export const SCAN_LIMIT = 5000;

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'out-test',
  'build',
  '.vscode-test',
  'coverage',
  '.sandbox',
]);

/**
 * True when `uri` is within workspace scan scope — i.e. NOT inside any excluded directory.
 * Content-independent and consistent with {@link SCAN_EXCLUDE}, so editor-triggered scans
 * tag findings the same way the workspace scan does.
 */
export function isInScanScope(uri: vscode.Uri): boolean {
  const rel = vscode.workspace.asRelativePath(uri, false);
  const segments = rel.split(/[\\/]/);
  return !segments.some((seg) => EXCLUDED_DIRS.has(seg));
}
