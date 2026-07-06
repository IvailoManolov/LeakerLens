import * as vscode from 'vscode';
import { ScanController, shouldClearOnClose } from './scanController';
import { createGutterDecoration, createEnvSafeDecoration } from './decorations';
import { LeakHoverProvider } from './hovers';
import { LeakCodeActionProvider } from './codeActions';
import { PanelController } from './panel/panelController';
import { registerCommands } from './commands';
import { ensureAgentRunners } from './agentRunners';

const FILE_SELECTOR: vscode.DocumentSelector = { scheme: 'file' };

/**
 * Extension entry point. Activation is lazy (`onStartupFinished`) and cheap: it only
 * wires event listeners and providers, then scans whatever is already open.
 */
export function activate(context: vscode.ExtensionContext): void {
  const normalDecoration = createGutterDecoration();
  const envSafeDecoration = createEnvSafeDecoration();
  const controller = new ScanController({ normal: normalDecoration, envSafe: envSafeDecoration });
  const panel = new PanelController(context.extensionUri, controller);

  // Re-color open `.env` files when `.gitignore` changes (the cached gitignore answer is stale).
  const gitignoreWatcher = vscode.workspace.createFileSystemWatcher('**/.gitignore');
  const onGitignoreChange = (): void => {
    controller.invalidateEnvCache();
    for (const editor of vscode.window.visibleTextEditors) {
      void controller.scanNow(editor.document);
    }
  };
  gitignoreWatcher.onDidChange(onGitignoreChange);
  gitignoreWatcher.onDidCreate(onGitignoreChange);
  gitignoreWatcher.onDidDelete(onGitignoreChange);

  context.subscriptions.push(
    controller,
    normalDecoration,
    envSafeDecoration,
    gitignoreWatcher,
    panel,
    vscode.window.registerWebviewViewProvider(PanelController.viewId, panel, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.languages.registerHoverProvider(FILE_SELECTOR, new LeakHoverProvider(controller)),
    vscode.languages.registerCodeActionsProvider(FILE_SELECTOR, new LeakCodeActionProvider(controller), {
      providedCodeActionKinds: LeakCodeActionProvider.kinds,
    }),
    vscode.workspace.onDidChangeTextDocument((e) => controller.scheduleScan(e.document)),
    vscode.workspace.onDidOpenTextDocument((doc) => controller.scheduleScan(doc, 0)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (shouldClearOnClose(doc)) {
        controller.clear(doc.uri);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        controller.scheduleScan(editor.document, 0);
      }
    }),
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) {
        controller.refreshEditor(editor);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('leakerlens')) {
        controller.reloadConfig();
      }
    }),
  );

  registerCommands(context, controller, panel);

  // Refresh the version-stable MCP/CLI runner copies in globalStorage so agent configs written
  // by `leakerlens.setupAgentGuardrails` keep working across extension updates. Fire-and-forget:
  // it must never delay activation, and any failure is recovered at command time.
  void ensureAgentRunners(context).catch(() => {
    // Best-effort; the command re-runs this defensively before it needs the paths.
  });

  for (const editor of vscode.window.visibleTextEditors) {
    void controller.scanNow(editor.document);
  }
}

export function deactivate(): void {
  // Subscriptions are disposed automatically by VS Code.
}
