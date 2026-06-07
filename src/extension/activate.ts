import * as vscode from 'vscode';
import { ScanController } from './scanController';
import { createGutterDecoration } from './decorations';
import { LeakHoverProvider } from './hovers';
import { LeakCodeActionProvider } from './codeActions';
import { PanelController } from './panel/panelController';
import { registerCommands } from './commands';
import { License } from '../license/license';

const FILE_SELECTOR: vscode.DocumentSelector = { scheme: 'file' };

/**
 * Extension entry point. Activation is lazy (`onStartupFinished`) and cheap: it only
 * wires event listeners and providers, then scans whatever is already open.
 */
export function activate(context: vscode.ExtensionContext): void {
  const decorationType = createGutterDecoration();
  const controller = new ScanController(decorationType);
  const license = new License(context.globalState);
  const panel = new PanelController(context.extensionUri, controller);

  context.subscriptions.push(
    controller,
    decorationType,
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
    vscode.workspace.onDidCloseTextDocument((doc) => controller.clear(doc.uri)),
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
      if (e.affectsConfiguration('leaklens')) {
        controller.reloadConfig();
      }
    }),
  );

  registerCommands(context, controller, panel, license);

  for (const editor of vscode.window.visibleTextEditors) {
    controller.scanNow(editor.document);
  }
}

export function deactivate(): void {
  // Subscriptions are disposed automatically by VS Code.
}
