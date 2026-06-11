import { basename } from 'path';
import * as vscode from 'vscode';
import { readConfig } from './config';
import type { ScanController } from './scanController';
import type { PanelController } from './panel/panelController';
import { applyRemediation, type RemediationArg } from './remediation';
import { installPreCommitHook, uninstallPreCommitHook } from './git/preCommit';
import { SCAN_EXCLUDE, SCAN_LIMIT } from './scanScope';
import type { License } from '../license/license';

/** Register every contributed command. */
export function registerCommands(
  context: vscode.ExtensionContext,
  controller: ScanController,
  panel: PanelController,
  license: License,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('leaklens.scanWorkspace', () => scanWorkspace(controller, panel)),
    vscode.commands.registerCommand('leaklens.showSecretGraph', () => showSecretGraph(controller, panel)),
    vscode.commands.registerCommand('leaklens.focusPanel', () =>
      vscode.commands.executeCommand('leaklens.panel.focus'),
    ),
    vscode.commands.registerCommand('leaklens.applyRemediation', (arg: RemediationArg) =>
      applyRemediation(arg, controller),
    ),
    vscode.commands.registerCommand('leaklens.addEnvToGitignore', (uriStr: string) =>
      addEnvToGitignore(uriStr, controller),
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
  try {
    await controller.runWorkspaceScan(async () => {
      const [allFiles, envFiles] = await Promise.all([
        vscode.workspace.findFiles('**/*', SCAN_EXCLUDE, SCAN_LIMIT),
        // The `**/*` glob can skip dotfiles, so a `.env` may never get scanned by a workspace
        // rescan — meaning its green "safe" secrets never appear in the panel. Enumerate the
        // dotenv variants explicitly and merge so they're always scanned.
        vscode.workspace.findFiles('**/{.env,.env.*,*.env}', SCAN_EXCLUDE, SCAN_LIMIT),
      ]);
      const seen = new Set<string>();
      const files = [...allFiles, ...envFiles].filter((f) => {
        const key = f.toString();
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
      for (const file of files) {
        try {
          const doc = await vscode.workspace.openTextDocument(file);
          await controller.scanNow(doc); // awaits env classification
        } catch {
          // Skip unreadable/binary files.
        }
      }
    });
  } finally {
    panel.setScanning(false);
  }
  // Count only countable findings — secrets inside gitignored `.env` files don't count.
  let total = 0;
  for (const findings of controller.allCountableFindings().values()) {
    total += findings.length;
  }
  void vscode.window.showInformationMessage(
    total === 0 ? 'LeakLens: no secrets found. ✓' : `LeakLens: ${total} potential secret(s) found.`,
  );
  await vscode.commands.executeCommand('leaklens.panel.focus');
}

/**
 * Append the `.env` file's name to the workspace `.gitignore` (creating it if missing), then
 * re-scan so the exposed warning clears and the secrets settle into plain green.
 */
async function addEnvToGitignore(uriStr: string, controller: ScanController): Promise<void> {
  const uri = vscode.Uri.parse(uriStr);
  const folder = vscode.workspace.getWorkspaceFolder(uri) ?? firstWorkspaceFolder();
  if (!folder) {
    void vscode.window.showWarningMessage('LeakLens: open a folder to edit its .gitignore.');
    return;
  }
  const pattern = basename(uri.fsPath);
  const gitignore = vscode.Uri.joinPath(folder.uri, '.gitignore');

  let text = '';
  try {
    text = Buffer.from(await vscode.workspace.fs.readFile(gitignore)).toString('utf8');
  } catch {
    // No .gitignore yet — we'll create it.
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (!lines.includes(pattern)) {
    const prefix = text.length > 0 && !text.endsWith('\n') ? '\n' : '';
    const updated = `${text}${prefix}${pattern}\n`;
    await vscode.workspace.fs.writeFile(gitignore, Buffer.from(updated, 'utf8'));
  }

  controller.invalidateEnvCache();
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await controller.scanNow(doc);
  } catch {
    // File gone — nothing to re-scan.
  }
  void vscode.window.showInformationMessage(`LeakLens: added "${pattern}" to .gitignore. ✓`);
}

async function showSecretGraph(controller: ScanController, panel: PanelController): Promise<void> {
  // The graph is workspace-wide, so make sure findings are populated before showing it.
  await scanWorkspace(controller, panel);
  panel.setView('map');
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
