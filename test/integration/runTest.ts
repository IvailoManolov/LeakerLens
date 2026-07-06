import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { runTests } from '@vscode/test-electron';

/**
 * The suite's verdict file (written by suite/index.ts). The shim launches the test window via
 * VS Code's cli.js, which DETACHES: runTests() resolves in seconds with exit code 0 while the
 * window is still executing mocha, so the exit code is meaningless. We poll for this file and
 * derive OUR exit code from its content — without it a fully failing suite reported success.
 */
const RESULT_FILE = path.resolve(__dirname, '../../integration-result.json');
const RESULT_TIMEOUT_MS = 5 * 60 * 1000;

interface SuiteResult {
  readonly passes: number;
  readonly failures: ReadonlyArray<{ title: string; message: string }>;
}

async function waitForResult(): Promise<SuiteResult> {
  const start = Date.now();
  while (Date.now() - start < RESULT_TIMEOUT_MS) {
    if (fs.existsSync(RESULT_FILE)) {
      return JSON.parse(fs.readFileSync(RESULT_FILE, 'utf8')) as SuiteResult;
    }
    await new Promise<void>((r) => setTimeout(r, 500));
  }
  throw new Error(`No test result at ${RESULT_FILE} after ${RESULT_TIMEOUT_MS / 1000}s — the test window never finished (or crashed before mocha ran).`);
}

/**
 * VS Code 1.122+ dropped the --no-sandbox CLI flag that @vscode/test-electron 2.x
 * unconditionally passes. We route through a shim script (vscode-shim.js) that strips
 * those flags before forwarding to the real Code.exe, so the test harness stays compatible
 * with the installed VS Code version without patching node_modules.
 *
 * The shim is compiled into out-test/test/integration/vscode-shim.js by tsc, but it's a
 * plain .js file (not .ts), so it's copied by the pretest:integration script instead.
 * We locate the shim relative to this compiled file's __dirname.
 */
// On Windows, @vscode/test-electron spawns via shell:true, so the executable must be
// invocable from cmd.exe. A .cmd file is the reliable way to invoke a Node.js script.
const SHIM_PATH = path.resolve(__dirname, './vscode-shim.cmd');
const SYSTEM_CODE_EXE = 'K:\\Microsoft VS Code\\Code.exe';

/** Download a sandboxed VS Code and run the smoke suite inside it. */
async function main(): Promise<void> {
  try {
    // out-test/test/integration → repo root
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // Use the shim as the executable if it exists AND the system Code.exe is present.
    // The shim strips --no-sandbox / --disable-gpu-sandbox flags that VS Code 1.122+
    // no longer accepts. Fall back to the downloaded VS Code (which will fail with the
    // sandbox flags error) if neither is available — the compile-only check still passes.
    const useShim = fs.existsSync(SHIM_PATH) && fs.existsSync(SYSTEM_CODE_EXE);

    // Open an empty temp folder as the single workspace folder so tests that exercise
    // workspace-scoped behavior (e.g. .gitignore-aware scanning) have a real folder root for
    // `vscode.workspace.getWorkspaceFolder`. Launching with the first folder up front avoids the
    // extension-host restart that `updateWorkspaceFolders` would trigger on an empty window.
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leakerlens-ws-'));
    const launchArgs = [workspaceDir];

    const opts = useShim
      ? { extensionDevelopmentPath, extensionTestsPath, vscodeExecutablePath: SHIM_PATH, launchArgs }
      : { extensionDevelopmentPath, extensionTestsPath, launchArgs };

    fs.rmSync(RESULT_FILE, { force: true });
    await runTests(opts);

    const result = await waitForResult();
    if (result.failures.length > 0) {
      console.error(`\n${result.failures.length} integration test(s) FAILED (${result.passes} passed):`);
      for (const f of result.failures) {
        console.error(`  ✗ ${f.title}\n      ${f.message}`);
      }
      process.exit(1);
    }
    console.log(`Integration tests: ${result.passes} passed, 0 failed.`);
  } catch (err) {
    console.error('Failed to run integration tests:', err);
    process.exit(1);
  }
}

void main();
