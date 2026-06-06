import { build, context } from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

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

async function run() {
  if (watch) {
    const ctxs = await Promise.all([
      context(extensionConfig),
      context(webviewConfig),
      context(hookConfig),
    ]);
    await Promise.all(ctxs.map((c) => c.watch()));
    console.log('[esbuild] watching…');
  } else {
    await Promise.all([build(extensionConfig), build(webviewConfig), build(hookConfig)]);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
