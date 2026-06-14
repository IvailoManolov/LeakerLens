import * as vscode from 'vscode';
import { EXCLUDED_DIRS, isExcludedPath } from '../engine/scope';

/**
 * Glob form of {@link EXCLUDED_DIRS} for `vscode.workspace.findFiles`. Derived from the shared
 * set so the glob and the segment predicate can never drift apart.
 */
export const SCAN_EXCLUDE = `**/{${[...EXCLUDED_DIRS].join(',')}}/**`;
export const SCAN_LIMIT = 5000;

/**
 * True when `uri` is within workspace scan scope — i.e. NOT inside any excluded directory.
 * Content-independent and consistent with {@link SCAN_EXCLUDE}, so editor-triggered scans
 * tag findings the same way the workspace scan does. Delegates to the shared, pure
 * {@link isExcludedPath} so the extension and the CLI share one dir list.
 */
export function isInScanScope(uri: vscode.Uri): boolean {
  return !isExcludedPath(vscode.workspace.asRelativePath(uri, false));
}
