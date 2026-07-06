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

const ENV_VAR_NAME = 'LEAKERLENS_SECRET';

/**
 * Apply a remediation. All three mutate the file — only ever invoked by an explicit
 * user action (quick-fix, hover link, or panel button), never automatically.
 */
export async function applyRemediation(arg: RemediationArg, controller: ScanController): Promise<void> {
  try {
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
  } catch (err) {
    // Never fail silently — surface why the action didn't apply.
    void vscode.window.showErrorMessage(`LeakerLens: couldn't apply "${arg.kind}" — ${(err as Error).message}`);
  }
}

/** Append the inline suppression marker to the finding's line. */
async function applyIgnore(uri: vscode.Uri, doc: vscode.TextDocument, line: number): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  const eol = new vscode.Position(line, doc.lineAt(line).text.length);
  edit.insert(uri, eol, ' // leakerlens:ignore');
  await vscode.workspace.applyEdit(edit);
}

/** Replace the secret with an all-asterisks mask of the same length. */
async function applyMask(uri: vscode.Uri, doc: vscode.TextDocument, range: vscode.Range): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, range, maskAll(doc.getText(range)));
  await vscode.workspace.applyEdit(edit);
}

/**
 * Move the secret into a `.env` and replace it in source with an env lookup. The `.env`
 * lives at the workspace-folder root when the file is in one, otherwise right next to the
 * file — so this works even for a single loose file. A fresh variable name is chosen each
 * time so moving several secrets never clobbers an earlier one.
 */
async function applyMoveToEnv(uri: vscode.Uri, doc: vscode.TextDocument, range: vscode.Range): Promise<void> {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  const base = folder ? folder.uri : vscode.Uri.joinPath(uri, '..');
  const envUri = vscode.Uri.joinPath(base, '.env');

  const secret = doc.getText(range);
  const existing = await readTextOrEmpty(envUri);
  const varName = uniqueEnvName(existing);
  const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  await vscode.workspace.fs.writeFile(envUri, Buffer.from(`${existing}${sep}${varName}=${secret}\n`, 'utf8'));

  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, range, `process.env.${varName}`);
  await vscode.workspace.applyEdit(edit);
  void vscode.window.showInformationMessage(`LeakerLens: moved secret to .env as ${varName}.`);
}

/** Pick an env var name that isn't already defined in the `.env` contents. */
function uniqueEnvName(envContents: string): string {
  if (!envContents.includes(`${ENV_VAR_NAME}=`)) {
    return ENV_VAR_NAME;
  }
  let i = 2;
  while (envContents.includes(`${ENV_VAR_NAME}_${i}=`)) {
    i += 1;
  }
  return `${ENV_VAR_NAME}_${i}`;
}

async function readTextOrEmpty(uri: vscode.Uri): Promise<string> {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  } catch {
    return '';
  }
}
