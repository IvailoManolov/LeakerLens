import * as path from 'path';
import { runTests } from '@vscode/test-electron';

/** Download a sandboxed VS Code and run the smoke suite inside it. */
async function main(): Promise<void> {
  try {
    // out-test/test/integration → repo root
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');
    await runTests({ extensionDevelopmentPath, extensionTestsPath });
  } catch (err) {
    console.error('Failed to run integration tests:', err);
    process.exit(1);
  }
}

void main();
