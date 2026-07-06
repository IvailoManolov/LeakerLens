import { chmodSync } from 'fs';
import * as vscode from 'vscode';

const RUNNER_NAME = 'leakerlens-precommit.cjs';
const MARKER = 'leakerlens-precommit';

/**
 * Install the opt-in pre-commit guard into `<folder>/.git/hooks`. Copies the bundled
 * runner locally (robust across extension updates) and writes a `pre-commit` shell that
 * invokes it. `blocking` is baked in at install time (from the `leakerlens.commitBlocking` setting).
 */
export async function installPreCommitHook(
  extensionUri: vscode.Uri,
  folderUri: vscode.Uri,
  blocking: boolean,
): Promise<void> {
  const hooksDir = await ensureHooksDir(folderUri);

  const runnerSrc = vscode.Uri.joinPath(extensionUri, 'dist', 'precommit.js');
  const runnerBytes = await vscode.workspace.fs.readFile(runnerSrc);
  const runnerDst = vscode.Uri.joinPath(hooksDir, RUNNER_NAME);
  await vscode.workspace.fs.writeFile(runnerDst, runnerBytes);

  const script =
    `#!/bin/sh\n` +
    `# Installed by LeakerLens (${MARKER}). Scans staged changes for secrets.\n` +
    `LEAKERLENS_BLOCK=${blocking ? '1' : '0'} node "$(dirname "$0")/${RUNNER_NAME}"\n` +
    `exit $?\n`;
  const hookUri = vscode.Uri.joinPath(hooksDir, 'pre-commit');
  await vscode.workspace.fs.writeFile(hookUri, Buffer.from(script, 'utf8'));
  makeExecutable(hookUri);
}

/** Remove the guard if (and only if) it is ours. */
export async function uninstallPreCommitHook(folderUri: vscode.Uri): Promise<void> {
  const hooksDir = vscode.Uri.joinPath(folderUri, '.git', 'hooks');
  const hookUri = vscode.Uri.joinPath(hooksDir, 'pre-commit');
  const current = await readTextOrEmpty(hookUri);
  if (current.includes(MARKER)) {
    await deleteIfExists(hookUri);
    await deleteIfExists(vscode.Uri.joinPath(hooksDir, RUNNER_NAME));
  }
}

async function ensureHooksDir(folderUri: vscode.Uri): Promise<vscode.Uri> {
  const gitDir = vscode.Uri.joinPath(folderUri, '.git');
  try {
    await vscode.workspace.fs.stat(gitDir);
  } catch {
    throw new Error('This folder is not a git repository.');
  }
  const hooksDir = vscode.Uri.joinPath(gitDir, 'hooks');
  await vscode.workspace.fs.createDirectory(hooksDir);
  return hooksDir;
}

function makeExecutable(uri: vscode.Uri): void {
  try {
    chmodSync(uri.fsPath, 0o755);
  } catch {
    // No-op on platforms/filesystems without POSIX permissions (e.g. Windows).
  }
}

async function readTextOrEmpty(uri: vscode.Uri): Promise<string> {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  } catch {
    return '';
  }
}

async function deleteIfExists(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri);
  } catch {
    // Already gone.
  }
}
