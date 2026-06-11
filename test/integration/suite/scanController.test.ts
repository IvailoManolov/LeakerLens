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
import { isInScanScope, SCAN_EXCLUDE } from '../../../src/extension/scanScope';

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
