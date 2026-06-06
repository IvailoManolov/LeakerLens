import * as vscode from 'vscode';
import { maskAll, type RemediationKind } from '../engine';
import type { ScanController } from './scanController';

/** Payload carried by hover links, quick-fixes, and panel actions. */
export interface RemediationArg {
  readonly uri: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly kind: RemediationKind;
}

const ENV_VAR_NAME = 'LEAKLENS_SECRET';

/**
 * Apply a remediation. All three mutate the file — only ever invoked by an explicit
 * user action (quick-fix, hover link, or panel button), never automatically.
 */
export async function applyRemediation(arg: RemediationArg, controller: ScanController): Promise<void> {
  const uri = vscode.Uri.parse(arg.uri);
  const doc = await vscode.workspace.openTextDocument(uri);
  const range = new vscode.Range(doc.positionAt(arg.start), doc.positionAt(arg.end));

  if (arg.kind === 'ignore') {
    await applyIgnore(uri, doc, arg.line);
  } else if (arg.kind === 'mask') {
    await applyMask(uri, doc, range);
  } else {
    await applyMoveToEnv(uri, doc, range);
  }

  controller.scheduleScan(doc, 0);
}

/** Append the inline suppression marker to the finding's line. */
async function applyIgnore(uri: vscode.Uri, doc: vscode.TextDocument, line: number): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  const eol = new vscode.Position(line, doc.lineAt(line).text.length);
  edit.insert(uri, eol, ' // leaklens:ignore');
  await vscode.workspace.applyEdit(edit);
}

/** Replace the secret with an all-asterisks mask of the same length. */
async function applyMask(uri: vscode.Uri, doc: vscode.TextDocument, range: vscode.Range): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, range, maskAll(doc.getText(range)));
  await vscode.workspace.applyEdit(edit);
}

/**
 * Move the secret into a workspace `.env` and replace it in source with an env lookup.
 * Best-effort for v1: requires a workspace folder; uses a single env var name.
 */
async function applyMoveToEnv(uri: vscode.Uri, doc: vscode.TextDocument, range: vscode.Range): Promise<void> {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    void vscode.window.showWarningMessage('LeakLens: open a workspace folder to move secrets to .env.');
    return;
  }
  const secret = doc.getText(range);
  const envUri = vscode.Uri.joinPath(folder.uri, '.env');
  const existing = await readTextOrEmpty(envUri);
  const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const next = `${existing}${sep}${ENV_VAR_NAME}=${secret}\n`;
  await vscode.workspace.fs.writeFile(envUri, Buffer.from(next, 'utf8'));

  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, range, `process.env.${ENV_VAR_NAME}`);
  await vscode.workspace.applyEdit(edit);
  void vscode.window.showInformationMessage(`LeakLens: moved secret to .env as ${ENV_VAR_NAME}.`);
}

async function readTextOrEmpty(uri: vscode.Uri): Promise<string> {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  } catch {
    return '';
  }
}
