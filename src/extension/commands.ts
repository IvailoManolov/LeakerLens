import * as vscode from 'vscode';
import { readConfig } from './config';
import type { ScanController } from './scanController';
import type { PanelController } from './panel/panelController';
import { applyRemediation, type RemediationArg } from './remediation';
import { installPreCommitHook, uninstallPreCommitHook } from './git/preCommit';
import type { License } from '../license/license';

const SCAN_EXCLUDE = '**/{node_modules,.git,dist,out,build,.vscode-test,coverage}/**';
const SCAN_LIMIT = 5000;

/** Register every contributed command. */
export function registerCommands(
  context: vscode.ExtensionContext,
  controller: ScanController,
  panel: PanelController,
  license: License,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('leaklens.scanWorkspace', () => scanWorkspace(controller, panel)),
    vscode.commands.registerCommand('leaklens.focusPanel', () =>
      vscode.commands.executeCommand('leaklens.panel.focus'),
    ),
    vscode.commands.registerCommand('leaklens.applyRemediation', (arg: RemediationArg) =>
      applyRemediation(arg, controller),
    ),
    vscode.commands.registerCommand('leaklens.installGitHook', () =>
      installGitHook(context.extensionUri, license),
    ),
    vscode.commands.registerCommand('leaklens.uninstallGitHook', () => uninstallGitHook()),
    vscode.commands.registerCommand('leaklens.activateLicense', () => activateLicense(license)),
  );
}

async function scanWorkspace(controller: ScanController, panel: PanelController): Promise<void> {
  panel.setScanning(true);
  let total = 0;
  try {
    const files = await vscode.workspace.findFiles('**/*', SCAN_EXCLUDE, SCAN_LIMIT);
    for (const file of files) {
      try {
        const doc = await vscode.workspace.openTextDocument(file);
        controller.scanNow(doc);
        total += controller.getFindings(doc.uri).length;
      } catch {
        // Skip unreadable/binary files.
      }
    }
  } finally {
    panel.setScanning(false);
  }
  void vscode.window.showInformationMessage(
    total === 0 ? 'LeakLens: no secrets found. ✓' : `LeakLens: ${total} potential secret(s) found.`,
  );
  await vscode.commands.executeCommand('leaklens.panel.focus');
}

async function installGitHook(extensionUri: vscode.Uri, license: License): Promise<void> {
  const folder = firstWorkspaceFolder();
  if (!folder) {
    void vscode.window.showWarningMessage('LeakLens: open a folder to install the pre-commit guard.');
    return;
  }
  const blocking = readConfig().commitBlocking && license.isPro();
  try {
    await installPreCommitHook(extensionUri, folder.uri, blocking);
  } catch (err) {
    void vscode.window.showErrorMessage(`LeakLens: ${(err as Error).message}`);
    return;
  }
  if (readConfig().commitBlocking && !license.isPro()) {
    void vscode.window.showInformationMessage(
      'LeakLens pre-commit guard installed (warn-only). Commit-blocking is a Pro feature.',
    );
  } else {
    void vscode.window.showInformationMessage(
      blocking
        ? 'LeakLens pre-commit guard installed — commits with secrets will be blocked.'
        : 'LeakLens pre-commit guard installed (warn-only).',
    );
  }
}

async function uninstallGitHook(): Promise<void> {
  const folder = firstWorkspaceFolder();
  if (!folder) {
    return;
  }
  await uninstallPreCommitHook(folder.uri);
  void vscode.window.showInformationMessage('LeakLens pre-commit guard removed.');
}

async function activateLicense(license: License): Promise<void> {
  const key = await vscode.window.showInputBox({
    prompt: 'Enter your LeakLens Pro license key',
    ignoreFocusOut: true,
    placeHolder: 'xxxxxxxx.xxxxxxxx',
  });
  if (!key) {
    return;
  }
  const ok = await license.activate(key.trim());
  void (ok
    ? vscode.window.showInformationMessage('LeakLens Pro activated — thank you! ✓')
    : vscode.window.showWarningMessage('That license key could not be verified.'));
}

function firstWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}
