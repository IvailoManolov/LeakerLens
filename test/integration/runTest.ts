import * as path from 'path';
import * as fs from 'fs';
import { runTests } from '@vscode/test-electron';

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
    const opts = useShim
      ? { extensionDevelopmentPath, extensionTestsPath, vscodeExecutablePath: SHIM_PATH }
      : { extensionDevelopmentPath, extensionTestsPath };

    await runTests(opts);
  } catch (err) {
    console.error('Failed to run integration tests:', err);
    process.exit(1);
  }
}

void main();
