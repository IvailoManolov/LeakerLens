/**
 * Headless `leakerlens` CLI. Bundled to `dist/cli.js` (Node, CJS) and exposed via the
 * package `bin` so AI coding agents and CI can scan for secrets from a terminal. It reuses
 * the *pure* detection engine ({@link ../engine}) verbatim — no detection logic lives here,
 * and like the git hook runner it never touches `vscode` and makes no network calls.
 *
 * Subcommands:
 *   `leakerlens scan [globs/paths...]` (or `--stdin --filename <name>`)
 *   `leakerlens mcp`  — start the local stdio MCP server for AI coding agents.
 * Output: human text (default), `--json`, or `--sarif`. Exit codes: 0 = clean,
 * 1 = findings present, 2 = usage/IO error.
 *
 * This file is intentionally thin: all `scan` logic lives in `./core.ts` so it can be
 * unit-tested directly without spawning a subprocess. The `mcp` server lives in its OWN
 * bundle (`dist/mcp.js`) and is `require`d lazily here, so the MCP SDK never bloats the
 * hot-path `dist/cli.js`.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { mainCore } from './core';

/** Read all of stdin synchronously as UTF-8. */
function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Hand off to the standalone MCP server bundle. Lazily required so the SDK is loaded only
 * when this subcommand runs — it is NOT linked into the CLI bundle. Never resolves under
 * normal operation: the server runs until the client disconnects.
 */
function runMcp(): void {
  // reason: dynamic path keeps the MCP SDK out of dist/cli.js (esbuild can't follow a
  // computed require), so the per-scan CLI bundle stays lean.
  const mcpModulePath = join(__dirname, 'mcp.js');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mcp = require(mcpModulePath) as { start: () => Promise<void> };
  mcp.start().catch((err: unknown) => {
    process.stderr.write(`leakerlens: MCP server failed: ${String(err)}\n`);
    process.exit(1);
  });
}

if (process.argv[2] === 'mcp') {
  runMcp();
  // The stdio server holds the event loop open; do not fall through to the scan path.
} else {
  runScanCli();
}

/** Synchronous `scan`/help dispatch — the original CLI behaviour. */
function runScanCli(): void {
  const { exitCode, stdout, stderr } = mainCore(process.argv.slice(2), {
    stdinContent: readStdin(),
    cwd: process.cwd(),
  });

  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }
  process.exit(exitCode);
}
