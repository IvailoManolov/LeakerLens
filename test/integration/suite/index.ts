import * as path from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import Mocha from 'mocha';
import { glob } from 'glob';

/**
 * Where the run's verdict lands: out-test/integration-result.json. runTest.ts polls for this
 * file because the Windows shim launches the test window via VS Code's cli.js, which DETACHES
 * — the harness process exits 0 in seconds while tests are still running, so the process exit
 * code can never carry mocha's result (that silent-green bug hid real failures).
 */
const RESULT_FILE = path.resolve(__dirname, '../../../integration-result.json');

interface FailureRecord {
  readonly title: string;
  readonly message: string;
}

/** Mocha entry point invoked inside the VS Code test host. */
export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', color: false, timeout: 30000 });
  const testsRoot = path.resolve(__dirname, '.');
  const files = await glob('**/*.test.js', { cwd: testsRoot });
  for (const file of files) {
    mocha.addFile(path.resolve(testsRoot, file));
  }

  const failures: FailureRecord[] = [];
  let passes = 0;

  try {
    await new Promise<void>((resolve) => {
      const runner = mocha.run(() => resolve());
      runner.on('pass', () => {
        passes += 1;
      });
      runner.on('fail', (test, err) => {
        failures.push({ title: test.fullTitle(), message: err instanceof Error ? err.message : String(err) });
      });
    });
    writeResult({ passes, failures });
  } catch (err) {
    writeResult({
      passes,
      failures: [...failures, { title: '(harness crash)', message: err instanceof Error ? err.stack ?? err.message : String(err) }],
    });
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length} test(s) failed.`);
  }
}

function writeResult(result: { passes: number; failures: FailureRecord[] }): void {
  mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
  writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2), 'utf8');
}
