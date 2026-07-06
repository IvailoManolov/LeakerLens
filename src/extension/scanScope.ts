import * as vscode from 'vscode';
import type { Ignore } from 'ignore';
import { EXCLUDED_DIRS, isExcludedPath } from '../engine/scope';
import { buildIgnore, isIgnored, toRelPosix } from '../cli/core';

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

/**
 * Drop files excluded by the project's `.gitignore` so the workspace scan matches the headless
 * CLI. `vscode.workspace.findFiles` only applies the hardcoded {@link SCAN_EXCLUDE} dirs and
 * NEVER reads `.gitignore`, which otherwise surfaces secrets in gitignored, generated files
 * (build/test output) the user doesn't consider real leaks. Reuses the CLI's
 * {@link buildIgnore}/{@link isIgnored} (rooted at each workspace folder's `.gitignore` plus the
 * shared {@link EXCLUDED_DIRS}) so the editor scan and `leakerlens scan` ignore the exact same files.
 *
 * One matcher per workspace folder, cached for the call. Files outside any workspace folder are
 * kept — we have no `.gitignore` root for them. Callers pass `.env` variants through a SEPARATE,
 * unfiltered list so a gitignored `.env` is still scanned and renders green/"safe" rather than
 * vanishing from the panel.
 */
export function filterGitignored(files: readonly vscode.Uri[]): vscode.Uri[] {
  const matchers = new Map<string, Ignore>();
  const kept: vscode.Uri[] = [];
  for (const uri of files) {
    const root = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
    if (root === undefined) {
      kept.push(uri);
      continue;
    }
    let ig = matchers.get(root);
    if (!ig) {
      ig = buildIgnore(root);
      matchers.set(root, ig);
    }
    if (!isIgnored(ig, toRelPosix(root, uri.fsPath))) {
      kept.push(uri);
    }
  }
  return kept;
}
