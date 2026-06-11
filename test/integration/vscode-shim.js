#!/usr/bin/env node
/**
 * Shim that makes @vscode/test-electron 2.x compatible with VS Code 1.122+ on Windows.
 *
 * Problem: @vscode/test-electron passes CLI flags (--no-sandbox, --extensionTestsPath,
 * etc.) directly to Code.exe. VS Code 1.122+ on Windows requires those flags to be
 * passed through cli.js via ELECTRON_RUN_AS_NODE=1, otherwise Code.exe treats them
 * as unknown Node.js flags and exits with code 9.
 *
 * This shim:
 *   1. Strips --no-sandbox and --disable-gpu-sandbox (removed in VS Code 1.122+).
 *   2. Locates the cli.js for the VS Code version pointed to by CODE_DIR.
 *   3. Sets ELECTRON_RUN_AS_NODE=1 and prepends cli.js to the argument list.
 *   4. Spawns Code.exe with those corrected arguments.
 *
 * @vscode/test-electron on Windows uses shell:true and wraps the path in quotes,
 * so this script is invoked via vscode-shim.cmd which calls `node vscode-shim.js %*`.
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CODE_DIR = 'K:\\leak-extension\\LeakerLens\\.vscode-test\\vscode-win32-x64-archive-1.124.0';
const CODE_EXE = path.join(CODE_DIR, 'Code.exe');

// Find cli.js — it lives in <commit-hash>/resources/app/out/cli.js.
// The commit-hash directory is the only non-standard directory entry in CODE_DIR.
const STANDARD_ENTRIES = new Set(['bin', 'policies', 'tools', 'appx']);
const commitDir = fs
  .readdirSync(CODE_DIR)
  .find(
    (entry) =>
      !STANDARD_ENTRIES.has(entry) &&
      !entry.includes('.') &&
      fs.statSync(path.join(CODE_DIR, entry)).isDirectory(),
  );
if (!commitDir) {
  console.error('vscode-shim: could not find commit hash directory in', CODE_DIR);
  process.exit(1);
}
const CLI_JS = path.join(CODE_DIR, commitDir, 'resources', 'app', 'out', 'cli.js');
if (!fs.existsSync(CLI_JS)) {
  console.error('vscode-shim: cli.js not found at', CLI_JS);
  process.exit(1);
}

// Flags that VS Code 1.122+ dropped from direct Code.exe invocation.
const STRIP = new Set(['--no-sandbox', '--disable-gpu-sandbox']);

const args = [CLI_JS, ...process.argv.slice(2).filter((a) => !STRIP.has(a))];

const result = spawnSync(CODE_EXE, args, {
  stdio: 'inherit',
  windowsHide: false,
  shell: false,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});

process.exit(result.status ?? 1);
