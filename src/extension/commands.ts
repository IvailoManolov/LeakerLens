import { basename } from 'path';
import * as vscode from 'vscode';
import { readConfig } from './config';
import type { ScanController } from './scanController';
import type { PanelController } from './panel/panelController';
import { applyRemediation, type RemediationArg } from './remediation';
import { installPreCommitHook, uninstallPreCommitHook } from './git/preCommit';
import { SCAN_EXCLUDE, SCAN_LIMIT, filterGitignored } from './scanScope';
import { ensureAgentRunners } from './agentRunners';
import {
  AGENT_TARGETS,
  buildInstructionBlock,
  buildServerEntry,
  mergeInstructionBlock,
  mergeMcpConfig,
  wrapBlock,
  type AgentTarget,
} from './agentSetup';

/** Register every contributed command. */
export function registerCommands(
  context: vscode.ExtensionContext,
  controller: ScanController,
  panel: PanelController,
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
      installGitHook(context.extensionUri),
    ),
    vscode.commands.registerCommand('leaklens.uninstallGitHook', () => uninstallGitHook()),
    vscode.commands.registerCommand('leaklens.setupAgentGuardrails', () =>
      setupAgentGuardrails(context),
    ),
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
      // findFiles truncates to SCAN_LIMIT in enumeration order, which is not stable across
      // runs — past the cap, each rescan would silently scan a different subset and the count
      // would flip on an unchanged workspace. Say so instead of pretending the scan is total.
      if (allFiles.length >= SCAN_LIMIT) {
        void vscode.window.showWarningMessage(
          `LeakLens: workspace exceeds ${SCAN_LIMIT} files — scan results may be incomplete. Add generated folders to .gitignore to narrow the scan.`,
        );
      }
      const seen = new Set<string>();
      // Honor each workspace folder's `.gitignore` for ordinary files so the editor scan matches
      // the headless CLI — `findFiles` only applies SCAN_EXCLUDE and never reads `.gitignore`,
      // which otherwise flagged secrets in gitignored, generated files (build/test output). The
      // explicitly-enumerated `.env` variants are NOT filtered: a gitignored `.env` must still be
      // scanned so it renders green/"safe" rather than disappearing from the panel.
      const files = [...filterGitignored(allFiles), ...envFiles].filter((f) => {
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
  } catch (err) {
    // Without this, a failure after the scan's scope reset (e.g. findFiles rejecting) left an
    // empty panel that read as "no secrets found" — with no toast and no error, the next click
    // would flip back to the real count. Fail loudly instead of lying quietly.
    void vscode.window.showErrorMessage(`LeakLens: workspace scan failed — ${(err as Error).message}`);
    return;
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

async function installGitHook(extensionUri: vscode.Uri): Promise<void> {
  const folder = firstWorkspaceFolder();
  if (!folder) {
    void vscode.window.showWarningMessage('LeakLens: open a folder to install the pre-commit guard.');
    return;
  }
  const blocking = readConfig().commitBlocking;
  try {
    await installPreCommitHook(extensionUri, folder.uri, blocking);
  } catch (err) {
    void vscode.window.showErrorMessage(`LeakLens: ${(err as Error).message}`);
    return;
  }
  void vscode.window.showInformationMessage(
    blocking
      ? 'LeakLens pre-commit guard installed — commits with secrets will be blocked.'
      : 'LeakLens pre-commit guard installed (warn-only).',
  );
}

/**
 * `LeakLens: Set up agent guardrails`. Wires the bundled MCP server + CLI into the current
 * workspace's AI-agent tooling with zero manual config editing: merges a `leaklens` MCP server
 * into the selected agents' config files and writes a concise instruction block into
 * `AGENTS.md` (and `CLAUDE.md` if present + Claude selected). Idempotent — re-running yields
 * identical files.
 */
async function setupAgentGuardrails(context: vscode.ExtensionContext): Promise<void> {
  const folder = firstWorkspaceFolder();
  if (!folder) {
    void vscode.window.showErrorMessage('LeakLens: open a folder to set up agent guardrails.');
    return;
  }

  // Provision the stable, version-independent runner copies (refresh defensively at command
  // time in case activation predates an update or globalStorage was cleared).
  const { mcpPath, cliPath } = await ensureAgentRunners(context);

  const picks = await vscode.window.showQuickPick(
    AGENT_TARGETS.map((t) => ({ label: t.label, detail: t.detail, picked: true, target: t })),
    {
      canPickMany: true,
      title: 'LeakLens: configure which AI agents?',
      placeHolder: 'All are pre-selected — confirm to write their MCP configs.',
    },
  );
  if (picks === undefined) {
    return; // User cancelled.
  }
  const selected = picks.map((p) => p.target);

  const changed: string[] = [];

  // 1. Merge the leaklens MCP server into each selected agent's config.
  for (const target of selected) {
    await mergeMcpConfigFile(folder.uri, target, mcpPath);
    changed.push(target.configPath);
  }

  // 2. ALWAYS merge the instruction block into AGENTS.md (the cross-tool standard).
  const block = wrapBlock(buildInstructionBlock(cliPath));
  await mergeMarkdownBlock(vscode.Uri.joinPath(folder.uri, 'AGENTS.md'), block, true);
  changed.push('AGENTS.md');

  // …and into a root CLAUDE.md if it exists AND Claude Code was selected.
  if (selected.some((t) => t.id === 'claude')) {
    const claudeMd = vscode.Uri.joinPath(folder.uri, 'CLAUDE.md');
    if (await fileExists(claudeMd)) {
      await mergeMarkdownBlock(claudeMd, block, false);
      changed.push('CLAUDE.md');
    }
  }

  await showSetupSummary(changed, folder.uri);
}

/** Read a config file (if any), merge the leaklens server, and write it back pretty-printed. */
async function mergeMcpConfigFile(
  folderUri: vscode.Uri,
  target: AgentTarget,
  mcpPath: string,
): Promise<void> {
  const fileUri = vscode.Uri.joinPath(folderUri, ...target.configPath.split('/'));
  const existing = await readTextOrUndefined(fileUri);
  const entry = buildServerEntry(mcpPath, target.stdioType);
  const merged = mergeMcpConfig(existing, target.topLevelKey, entry);
  await ensureParentDir(fileUri);
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(merged, 'utf8'));
}

/**
 * Marker-merge the instruction block into a Markdown file. When `createIfMissing` is false and
 * the file is absent, this is a no-op (used for CLAUDE.md, which is only updated if it exists).
 */
async function mergeMarkdownBlock(
  fileUri: vscode.Uri,
  block: string,
  createIfMissing: boolean,
): Promise<void> {
  const existing = await readTextOrUndefined(fileUri);
  if (existing === undefined && !createIfMissing) {
    return;
  }
  const merged = mergeInstructionBlock(existing, block);
  await ensureParentDir(fileUri);
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(merged, 'utf8'));
}

/** Info toast summarizing the write, with quick follow-up actions. */
async function showSetupSummary(changed: readonly string[], folderUri: vscode.Uri): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `LeakLens agent guardrails set up — updated ${changed.join(', ')}. ✓`,
    'Open AGENTS.md',
    'Install commit guard',
  );
  if (choice === 'Open AGENTS.md') {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folderUri, 'AGENTS.md'));
    await vscode.window.showTextDocument(doc);
  } else if (choice === 'Install commit guard') {
    await vscode.commands.executeCommand('leaklens.installGitHook');
  }
}

/** Read a file as UTF-8, or `undefined` if it does not exist. */
async function readTextOrUndefined(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  } catch {
    return undefined;
  }
}

/** True if the file exists and is readable. */
async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** Create the parent directory of `uri` (no-op if it already exists). */
async function ensureParentDir(uri: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
}

async function uninstallGitHook(): Promise<void> {
  const folder = firstWorkspaceFolder();
  if (!folder) {
    return;
  }
  await uninstallPreCommitHook(folder.uri);
  void vscode.window.showInformationMessage('LeakLens pre-commit guard removed.');
}

function firstWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}
