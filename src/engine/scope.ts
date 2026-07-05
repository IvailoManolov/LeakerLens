/**
 * Workspace scan scope — the single source of truth for which directories are excluded
 * from scanning. Pure and `vscode`-free so both the extension glue ({@link ../extension/scanScope})
 * and the headless CLI consume the same list and the same predicate; the dir set must never
 * be duplicated.
 *
 * These are the gitignored build/output/sandbox dirs; scanning them pulls in generated files
 * (e.g. the compiled test suite in `out-test/`, full of fixture secrets) whose presence varies
 * between runs, which is what made repeated scans report different counts.
 */

/** Directory names that are never scanned, wherever they appear in a path. */
export const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'out-test',
  'build',
  '.vscode-test',
  'coverage',
  '.sandbox',
]);

/**
 * True when `relativePath` lies inside an excluded directory. Accepts either `/` or `\`
 * separators. Content-independent, so editor-triggered scans and the CLI walk tag files
 * the same way.
 *
 * @param relativePath A workspace-relative path (e.g. `src/foo.ts`, `out-test\bar.js`).
 */
export function isExcludedPath(relativePath: string): boolean {
  const segments = relativePath.split(/[\\/]/);
  return segments.some((seg) => EXCLUDED_DIRS.has(seg));
}
