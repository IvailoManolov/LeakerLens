import { build, context } from 'esbuild';
import { readFileSync } from 'fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** Single source of truth for bundled version stamps. */
const pkgVersion = JSON.parse(readFileSync('./package.json', 'utf8')).version;

/** Shared options. */
const common = {
  bundle: true,
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  target: 'es2021',
};

/** Extension host bundle (Node, CommonJS, vscode is external). */
const extensionConfig = {
  ...common,
  entryPoints: ['src/extension/activate.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
};

/** Webview client bundle (browser, IIFE, no Node APIs). */
const webviewConfig = {
  ...common,
  entryPoints: ['src/webview/main.ts'],
  outfile: 'dist/webview.js',
  platform: 'browser',
  format: 'iife',
};

/** Standalone git pre-commit runner (Node, bundles the pure engine, no vscode). */
const hookConfig = {
  ...common,
  entryPoints: ['src/extension/git/hookRunner.ts'],
  outfile: 'dist/precommit.js',
  platform: 'node',
  format: 'cjs',
};

/**
 * Headless CLI (Node, bundles the pure engine + the `ignore` dep, no vscode). The shebang is
 * injected as a banner so it survives bundling and `bin` execution.
 */
const cliConfig = {
  ...common,
  entryPoints: ['src/cli/index.ts'],
  outfile: 'dist/cli.js',
  platform: 'node',
  format: 'cjs',
  banner: { js: '#!/usr/bin/env node' },
};

/**
 * Standalone local MCP server (Node, CJS) for AI coding agents. Bundles the MCP SDK + zod +
 * the pure engine, and is `require`d lazily by the CLI's `mcp` subcommand — deliberately a
 * SEPARATE bundle so the SDK never bloats the hot-path `dist/cli.js`. The package version is
 * inlined via `define` so the server identity needs no runtime file read.
 */
const mcpConfig = {
  ...common,
  entryPoints: ['src/mcp/index.ts'],
  outfile: 'dist/mcp.js',
  platform: 'node',
  format: 'cjs',
  banner: { js: '#!/usr/bin/env node' },
  define: { __LEAKLENS_VERSION__: JSON.stringify(pkgVersion) },
};

async function run() {
  if (watch) {
    const ctxs = await Promise.all([
      context(extensionConfig),
      context(webviewConfig),
      context(hookConfig),
      context(cliConfig),
      context(mcpConfig),
    ]);
    await Promise.all(ctxs.map((c) => c.watch()));
    console.log('[esbuild] watching…');
  } else {
    await Promise.all([
      build(extensionConfig),
      build(webviewConfig),
      build(hookConfig),
      build(cliConfig),
      build(mcpConfig),
    ]);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
