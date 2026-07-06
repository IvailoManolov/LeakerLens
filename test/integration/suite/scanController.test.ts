/**
 * Integration smoke tests for ScanController seams introduced in the feature branch:
 *   - isInScanScope / SCAN_EXCLUDE / SCAN_LIMIT exports (real assertions, not structural stubs)
 *   - allCountableFindings() vs allSafeFindings() partition by env state
 *   - runWorkspaceScan() coalesces concurrent calls (fn runs once)
 *   - scanNow() returns Promise<void> and re-entrancy guard via runWorkspaceScan
 *   - Fix A: gitignored+tracked .env → Information diagnostic (env-tracked-but-ignored)
 *   - Fix B: out-test and .sandbox excluded from workspace scan scope
 *
 * These run inside the @vscode/test-electron harness so `vscode` is available.
 */
import * as assert from 'assert';
import { execFileSync, execFile } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { isInScanScope, SCAN_EXCLUDE, filterGitignored } from '../../../src/extension/scanScope';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempFile(name: string, content: string): vscode.Uri {
  const dir = mkdtempSync(path.join(tmpdir(), 'leaklens-sc-'));
  const file = path.join(dir, name);
  writeFileSync(file, content, 'utf8');
  return vscode.Uri.file(file);
}

async function waitFor(predicate: () => boolean, timeoutMs = 12000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition.');
    }
    await new Promise<void>((r) => setTimeout(r, 100));
  }
}

/** True if `git` is on PATH; used to skip git-backed tests gracefully. */
function isGitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// A real AWS-style key that the allowlist will not suppress.
const AWS_KEY = 'AKIAIOSFODNN7QWERTYZ';
const SECRET_LINE = `const k = "${AWS_KEY}"`;

// ---------------------------------------------------------------------------
// scanScope — isInScanScope real assertions (Fix B)
// ---------------------------------------------------------------------------

describe('scanScope — isInScanScope', () => {
  it('SCAN_EXCLUDE and SCAN_LIMIT are exported and the extension activates', async () => {
    const ext = vscode.extensions.getExtension('leaklens.leaklens');
    assert.ok(ext, 'extension must be installed');
    await ext.activate();
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(cmds.includes('leaklens.scanWorkspace'), 'scanWorkspace command registered');
  });

  it('SCAN_EXCLUDE contains out-test and .sandbox (Fix B: mirror guard)', () => {
    assert.ok(
      SCAN_EXCLUDE.includes('out-test'),
      `SCAN_EXCLUDE must contain "out-test" — got: ${SCAN_EXCLUDE}`,
    );
    assert.ok(
      SCAN_EXCLUDE.includes('.sandbox'),
      `SCAN_EXCLUDE must contain ".sandbox" — got: ${SCAN_EXCLUDE}`,
    );
    // Also verify the other standard exclusions are present
    assert.ok(SCAN_EXCLUDE.includes('node_modules'), 'SCAN_EXCLUDE must contain node_modules');
    assert.ok(SCAN_EXCLUDE.includes('.git'), 'SCAN_EXCLUDE must contain .git');
  });

  it('isInScanScope returns false for a URI inside out-test/ (Fix B)', () => {
    // Construct a fake URI that has an out-test segment somewhere in its path.
    // vscode.workspace.asRelativePath on a file outside the workspace returns the full
    // absolute path, which we then split — so embedding the segment in any position works.
    const fakeOutTestPath = path.join(tmpdir(), 'out-test', 'compiled', 'somefile.js');
    const uri = vscode.Uri.file(fakeOutTestPath);
    assert.strictEqual(
      isInScanScope(uri),
      false,
      'out-test URI must be out of scan scope',
    );
  });

  it('isInScanScope returns false for a URI inside .sandbox/ (Fix B)', () => {
    const fakeSandboxPath = path.join(tmpdir(), '.sandbox', 'experiment', 'secret.ts');
    const uri = vscode.Uri.file(fakeSandboxPath);
    assert.strictEqual(
      isInScanScope(uri),
      false,
      '.sandbox URI must be out of scan scope',
    );
  });

  it('isInScanScope returns false for a URI inside node_modules/', () => {
    const fakePath = path.join(tmpdir(), 'myproject', 'node_modules', 'some-pkg', 'index.js');
    const uri = vscode.Uri.file(fakePath);
    assert.strictEqual(
      isInScanScope(uri),
      false,
      'node_modules URI must be out of scan scope',
    );
  });

  it('isInScanScope returns true for an ordinary src/foo.ts URI', () => {
    const fakePath = path.join(tmpdir(), 'myproject', 'src', 'foo.ts');
    const uri = vscode.Uri.file(fakePath);
    assert.strictEqual(
      isInScanScope(uri),
      true,
      'src/foo.ts URI must be in scan scope',
    );
  });

  it('isInScanScope returns false for a URI inside .git/', () => {
    const fakePath = path.join(tmpdir(), 'myproject', '.git', 'COMMIT_EDITMSG');
    const uri = vscode.Uri.file(fakePath);
    assert.strictEqual(isInScanScope(uri), false, '.git URI must be out of scan scope');
  });
});

// ---------------------------------------------------------------------------
// scanScope — filterGitignored honors the project .gitignore (CLI parity)
//
// findFiles never reads .gitignore; the workspace scan would otherwise flag secrets in
// gitignored, generated files (build/test output) that the headless CLI skips. The host is
// launched with an empty temp folder as workspaceFolders[0] (see runTest.ts) so these tests
// have a real folder root for getWorkspaceFolder.
// ---------------------------------------------------------------------------

describe('scanScope — filterGitignored', () => {
  it('drops files under a gitignored dir but keeps unignored siblings', () => {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, 'integration host must open a workspace folder');
    const root = folders[0].uri.fsPath;

    // A .gitignore that ignores secrets/, plus an ignored and a visible secret file.
    writeFileSync(path.join(root, '.gitignore'), 'node_modules/\nsecrets/\n', 'utf8');
    mkdirSync(path.join(root, 'secrets'), { recursive: true });
    writeFileSync(path.join(root, 'secrets', 'leak.ts'), SECRET_LINE, 'utf8');
    mkdirSync(path.join(root, 'src'), { recursive: true });
    writeFileSync(path.join(root, 'src', 'leak.ts'), SECRET_LINE, 'utf8');

    const ignored = vscode.Uri.file(path.join(root, 'secrets', 'leak.ts'));
    const visible = vscode.Uri.file(path.join(root, 'src', 'leak.ts'));

    const kept = filterGitignored([ignored, visible]).map((u) => u.fsPath);
    assert.ok(!kept.includes(ignored.fsPath), 'gitignored file must be dropped from the scan');
    assert.ok(kept.includes(visible.fsPath), 'non-ignored file must be kept');
  });

  it('keeps files that lie outside any workspace folder (no .gitignore root)', () => {
    const outside = tempFile('outside.ts', SECRET_LINE); // created under tmpdir, not the workspace
    const kept = filterGitignored([outside]).map((u) => u.fsPath);
    assert.ok(kept.includes(outside.fsPath), 'file outside any workspace folder must be kept');
  });
});

// ---------------------------------------------------------------------------
// ScanController — allCountableFindings / allSafeFindings partition
// ---------------------------------------------------------------------------

describe('ScanController — findings partition', () => {
  it('scanNow produces a diagnostic for a real secret in an ordinary file', async () => {
    const uri = tempFile('ordinary.ts', SECRET_LINE);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);

    await waitFor(() => vscode.languages.getDiagnostics(uri).length > 0);
    const diags = vscode.languages.getDiagnostics(uri);
    assert.ok(diags.length >= 1, 'at least one diagnostic for the secret');
    assert.strictEqual(diags[0].source, 'LeakLens');
    assert.strictEqual(diags[0].code, 'aws-access-key-id');
  });

  it('scanNow produces no diagnostics for a clean file', async () => {
    const uri = tempFile('clean.ts', 'const greeting = "hello world";');
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);

    // Give the scan a moment; clean file should produce 0 diagnostics.
    await new Promise<void>((r) => setTimeout(r, 500));
    const diags = vscode.languages.getDiagnostics(uri);
    assert.strictEqual(diags.length, 0, 'no diagnostics for clean file');
  });

  it('scanWorkspace command completes without throwing', async () => {
    await assert.doesNotReject(
      () => Promise.resolve(vscode.commands.executeCommand('leaklens.scanWorkspace')),
      'scanWorkspace must not throw',
    );
  });
});

// ---------------------------------------------------------------------------
// ScanController — runWorkspaceScan coalesces concurrent calls
// ---------------------------------------------------------------------------

describe('ScanController — runWorkspaceScan coalesces concurrent calls', () => {
  it('a second call while one is in flight returns the same promise (fn runs once)', async () => {
    const ext = vscode.extensions.getExtension('leaklens.leaklens');
    assert.ok(ext, 'extension must be installed');
    await ext.activate();

    let resolved = 0;
    const p1 = vscode.commands
      .executeCommand('leaklens.scanWorkspace')
      .then(() => { resolved++; });
    const p2 = vscode.commands
      .executeCommand('leaklens.scanWorkspace')
      .then(() => { resolved++; });
    await Promise.all([p1, p2]);
    assert.strictEqual(resolved, 2, 'both concurrent callers must resolve');
  });
});

// ---------------------------------------------------------------------------
// ScanController — scanNow returns Promise<void> (awaitable)
// ---------------------------------------------------------------------------

describe('ScanController — scanNow is awaitable', () => {
  it('opening a document and waiting for diagnostics works deterministically', async () => {
    const uri = tempFile('awaitable.ts', SECRET_LINE);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);

    await waitFor(() => vscode.languages.getDiagnostics(uri).length > 0, 8000);
    const diags = vscode.languages.getDiagnostics(uri);
    assert.ok(diags.length >= 1, 'diagnostic appeared after scanNow settled');
  });
});

// ---------------------------------------------------------------------------
// Fix A — .env git classification: gitignored+tracked → Information advisory
// ---------------------------------------------------------------------------

/**
 * Creates a temp dir, runs git init, writes a .gitignore containing ".env", writes a
 * .env with a real secret, commits the .env (so it is BOTH gitignored and tracked), then
 * returns the path to the .env file.
 *
 * The returned dir must be unique per test so the git classifier runs git in the right cwd.
 */
function createTrackedButIgnoredEnvRepo(): string {
  const repoDir = mkdtempSync(path.join(tmpdir(), 'leaklens-git-'));
  const gitExec = (...args: string[]): void => {
    execFileSync('git', args, { cwd: repoDir, stdio: 'pipe' });
  };

  gitExec('init');
  // Minimal identity so git commit does not fail on a fresh machine.
  gitExec('config', 'user.email', 'test@leaklens.test');
  gitExec('config', 'user.name', 'LeakLens Test');

  // Write .gitignore that ignores .env
  writeFileSync(path.join(repoDir, '.gitignore'), '.env\n', 'utf8');
  gitExec('add', '.gitignore');
  gitExec('commit', '-m', 'init: add .gitignore');

  // Write .env with a real secret, then force-add and commit it.
  // Force-add bypasses the .gitignore rule so the file lands in the index (simulating a
  // developer who added the .env before adding the ignore rule, or used git add -f).
  writeFileSync(
    path.join(repoDir, '.env'),
    `LEAKLENS_SECRET=${AWS_KEY}\n`,
    'utf8',
  );
  gitExec('add', '-f', '.env');
  gitExec('commit', '-m', 'mistake: accidentally commit .env');

  return repoDir;
}

/**
 * Creates a temp dir with a git repo where .env is NOT in .gitignore and IS tracked.
 * This is the "exposed" path: git would commit the secrets.
 */
function createExposedEnvRepo(): string {
  const repoDir = mkdtempSync(path.join(tmpdir(), 'leaklens-git-exposed-'));
  const gitExec = (...args: string[]): void => {
    execFileSync('git', args, { cwd: repoDir, stdio: 'pipe' });
  };

  gitExec('init');
  gitExec('config', 'user.email', 'test@leaklens.test');
  gitExec('config', 'user.name', 'LeakLens Test');

  // No .gitignore rule for .env — the file is deliberately tracked without protection.
  writeFileSync(path.join(repoDir, '.gitignore'), '# intentionally empty\n', 'utf8');
  gitExec('add', '.gitignore');
  gitExec('commit', '-m', 'init');

  writeFileSync(
    path.join(repoDir, '.env'),
    `LEAKLENS_SECRET=${AWS_KEY}\n`,
    'utf8',
  );
  gitExec('add', '.env');
  gitExec('commit', '-m', 'add .env with secret');

  return repoDir;
}

describe('Fix A — .env git classification', () => {
  it('gitignored+tracked .env → exactly one Information diagnostic (env-tracked-but-ignored), zero Errors', async function () {
    // Skip gracefully when git is not available (e.g. in headless CI with no git).
    if (!isGitAvailable()) {
      // eslint-disable-next-line no-console
      console.log('  [skip] git not available');
      return;
    }

    const repoDir = createTrackedButIgnoredEnvRepo();
    const envPath = path.join(repoDir, '.env');
    const uri = vscode.Uri.file(envPath);

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);

    // Wait for the classifier to resolve and diagnostics to settle.
    // The expected outcome: exactly one Information diagnostic, code env-tracked-but-ignored,
    // and NO Error-severity diagnostics.
    // Allow generous timeout: two sequential git calls (check-ignore + ls-files) plus
    // VS Code's async scan scheduling.
    let lastDiagSnapshot: readonly vscode.Diagnostic[] = [];
    await waitFor(() => {
      const diags = vscode.languages.getDiagnostics(uri);
      lastDiagSnapshot = diags;
      return diags.some((d) => d.code === 'env-tracked-but-ignored');
    }, 18000).catch((err: Error) => {
      // Augment the timeout error with the actual diagnostic state for easier debugging.
      const codes = lastDiagSnapshot.map((d) => `${d.code}(sev=${d.severity})`).join(', ');
      throw new Error(`${err.message} — diagnostics at timeout: [${codes || 'none'}]`);
    });

    const diags = vscode.languages.getDiagnostics(uri);

    // Must have the tracked-but-ignored advisory.
    const advisory = diags.find((d) => d.code === 'env-tracked-but-ignored');
    assert.ok(advisory, 'must have env-tracked-but-ignored diagnostic');
    assert.strictEqual(
      advisory.severity,
      vscode.DiagnosticSeverity.Information,
      'advisory must be Information severity',
    );
    assert.strictEqual(advisory.source, 'LeakLens');

    // Must have NO error-severity diagnostics (secrets are green, not counted as leaks).
    const errors = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
    assert.strictEqual(
      errors.length,
      0,
      `gitignored .env must not produce Error diagnostics — got: ${JSON.stringify(errors.map((e) => e.code))}`,
    );

    // The advisory should be the only diagnostic (no env-not-gitignored warning either).
    const exposedWarning = diags.find((d) => d.code === 'env-not-gitignored');
    assert.ok(
      !exposedWarning,
      'gitignored .env must not have env-not-gitignored warning',
    );
  });

  it('exposed .env (tracked, NOT gitignored) → diagnostic with code env-not-gitignored', async function () {
    if (!isGitAvailable()) {
      console.log('  [skip] git not available');
      return;
    }

    const repoDir = createExposedEnvRepo();
    const envPath = path.join(repoDir, '.env');
    const uri = vscode.Uri.file(envPath);

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);

    // Wait for the exposed warning to appear.
    await waitFor(() => {
      const diags = vscode.languages.getDiagnostics(uri);
      return diags.some((d) => d.code === 'env-not-gitignored');
    }, 15000);

    const diags = vscode.languages.getDiagnostics(uri);

    const exposedWarning = diags.find((d) => d.code === 'env-not-gitignored');
    assert.ok(exposedWarning, 'exposed .env must have env-not-gitignored diagnostic');
    assert.strictEqual(
      exposedWarning.severity,
      vscode.DiagnosticSeverity.Warning,
      'exposed warning must be Warning severity',
    );
    assert.strictEqual(exposedWarning.source, 'LeakLens');

    // Must also have at least one Error diagnostic for the actual secret finding.
    const secretErrors = diags.filter(
      (d) =>
        d.severity === vscode.DiagnosticSeverity.Error &&
        d.code !== 'env-tracked-but-ignored',
    );
    assert.ok(
      secretErrors.length >= 1,
      'exposed .env must have at least one Error diagnostic for the secret',
    );
  });
});

// ---------------------------------------------------------------------------
// Rescan determinism — findings must not decay when VS Code closes documents
//
// The workspace scan loads every file via openTextDocument; VS Code garbage-closes those
// background documents at an arbitrary later time. onDidCloseTextDocument must NOT erase
// the findings — the file on disk still contains the secret, and clearing made the panel
// count silently decay (8 → 0) between rescans on an unchanged workspace.
// ---------------------------------------------------------------------------

describe('Rescan determinism — results survive document close', () => {
  it('keeps diagnostics when the editor tab closes (saved file, findings describe disk)', async function () {
    const uri = tempFile('persist.ts', SECRET_LINE);
    // Open via the editor ONLY — an extension-held openTextDocument reference would pin the
    // document and VS Code would defer the close indefinitely, hiding the behavior under test.
    await vscode.window.showTextDocument(uri);
    try {
      await waitFor(() => vscode.languages.getDiagnostics(uri).length > 0);
    } catch {
      throw new Error('diagnostics never appeared for the opened secret file');
    }

    // Event-driven close detection: VS Code disposes the underlying TextDocument on ITS own
    // schedule after the tab closes. If it defers past the window, skip — the deterministic
    // shouldClearOnClose test below still pins the contract.
    const closed = new Promise<boolean>((resolve) => {
      const sub = vscode.workspace.onDidCloseTextDocument((d) => {
        if (d.uri.toString() === uri.toString()) {
          sub.dispose();
          resolve(true);
        }
      });
      setTimeout(() => {
        sub.dispose();
        resolve(false);
      }, 15000);
    });
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    if (!(await closed)) {
      this.skip();
      return;
    }

    assert.ok(
      vscode.languages.getDiagnostics(uri).length >= 1,
      'diagnostics must survive the document close — the secret is still on disk',
    );
  });

  it('shouldClearOnClose: keeps saved file docs, drops untitled/dirty ones', async () => {
    const { shouldClearOnClose } = await import('../../../src/extension/scanController');

    const saved = await vscode.workspace.openTextDocument(tempFile('saved.ts', SECRET_LINE));
    assert.strictEqual(shouldClearOnClose(saved), false, 'saved file docs must be kept');

    const untitled = await vscode.workspace.openTextDocument({ content: SECRET_LINE });
    assert.strictEqual(shouldClearOnClose(untitled), true, 'untitled docs must be cleared');

    const dirtyUri = tempFile('dirty.ts', SECRET_LINE);
    const dirtyDoc = await vscode.workspace.openTextDocument(dirtyUri);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(dirtyUri, new vscode.Position(0, 0), '// dirty\n');
    await vscode.workspace.applyEdit(edit);
    assert.strictEqual(dirtyDoc.isDirty, true, 'precondition: doc must be dirty');
    assert.strictEqual(shouldClearOnClose(dirtyDoc), true, 'dirty docs must be cleared on close');
  });
});

// ---------------------------------------------------------------------------
// Rescan determinism — concurrent scanNow calls for the same document coalesce
//
// The scan loop's own openTextDocument fires onDidOpenTextDocument → scheduleScan(doc, 0),
// spawning a duplicate un-awaited scanNow that overwrote the findings array and made
// applyEnvStatus's staleness check drop the awaited 'exposed' classification. Same-version
// scans of the same document must share one promise.
// ---------------------------------------------------------------------------

describe('Rescan determinism — concurrent scanNow coalesces', () => {
  it('returns the same promise for the same unchanged document', async () => {
    // Import here (not top-level) so a compile failure surfaces in this test, not module load.
    const { ScanController } = await import('../../../src/extension/scanController');
    const controller = new ScanController({
      normal: vscode.window.createTextEditorDecorationType({}),
      envSafe: vscode.window.createTextEditorDecorationType({}),
    });
    try {
      const uri = tempFile('dedup.ts', SECRET_LINE);
      const doc = await vscode.workspace.openTextDocument(uri);
      const p1 = controller.scanNow(doc);
      const p2 = controller.scanNow(doc);
      assert.strictEqual(
        p1,
        p2,
        'two scanNow calls for the same doc+version must coalesce into one scan',
      );
      await Promise.all([p1, p2]);
    } finally {
      controller.dispose();
    }
  });
});
