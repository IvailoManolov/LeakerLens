/**
 * Bundle entry for the standalone MCP server (`dist/mcp.js`). Kept separate from the
 * hot-path `dist/cli.js` so the MCP SDK is never pulled into the per-scan CLI bundle.
 *
 * Exposes `start` for the CLI's `mcp` subcommand, which lazily `require`s this module at
 * runtime and calls `start()`. When run directly (`node dist/mcp.js`) it also boots, so the
 * file works as a plain executable too.
 */
import { start } from './server';

export { start };

// reason: `require.main === module` is the CJS "run directly" check; esbuild emits CJS, so
// when the file is the process entry (not lazily required by the CLI) we boot the server.
if (require.main === module) {
  start().catch((err: unknown) => {
    process.stderr.write(`LeakLens MCP server failed to start: ${String(err)}\n`);
    process.exit(1);
  });
}
