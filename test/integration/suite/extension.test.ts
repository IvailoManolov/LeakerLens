import * as assert from 'assert';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const SECRET_LINE = 'const k = "AKIAIOSFODNN7QWERTYZ"';

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition.');
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

function tempFile(name: string, content: string): vscode.Uri {
  const dir = mkdtempSync(path.join(tmpdir(), 'leaklens-'));
  const file = path.join(dir, name);
  writeFileSync(file, content, 'utf8');
  return vscode.Uri.file(file);
}

describe('LeakLens integration smoke', () => {
  it('activates and registers its commands', async () => {
    const ext = vscode.extensions.getExtension('leaklens.leaklens');
    assert.ok(ext, 'extension is installed');
    await ext.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('leaklens.scanWorkspace'), 'scanWorkspace registered');
    assert.ok(commands.includes('leaklens.applyRemediation'), 'applyRemediation registered');
    assert.ok(commands.includes('leaklens.showSecretGraph'), 'showSecretGraph registered');
  });

  it('runs the Secret Graph command without throwing', async () => {
    await vscode.commands.executeCommand('leaklens.showSecretGraph');
  });

  it('raises a diagnostic for a real secret in a file', async () => {
    const uri = tempFile('leak.ts', SECRET_LINE);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitFor(() => vscode.languages.getDiagnostics(uri).length > 0, 8000);

    const diagnostics = vscode.languages.getDiagnostics(uri);
    assert.ok(diagnostics.length >= 1, 'a diagnostic was produced');
    assert.strictEqual(diagnostics[0].source, 'LeakLens');
    assert.strictEqual(diagnostics[0].code, 'aws-access-key-id');
  });

  it('offers quick-fix code actions on the finding', async () => {
    const uri = tempFile('leak2.ts', SECRET_LINE);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitFor(() => vscode.languages.getDiagnostics(uri).length > 0, 8000);

    const range = new vscode.Range(0, 12, 0, 12);
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider',
      uri,
      range,
    );
    assert.ok(actions && actions.length >= 1, 'at least one quick-fix offered');
    assert.ok(actions.some((a) => a.title.startsWith('LeakLens:')), 'a LeakLens fix is present');
  });
});
