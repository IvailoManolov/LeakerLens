/**
 * False-positive gates. Precision over recall is the product's churn defense, so we
 * drop matches that look like documentation, placeholders, or example/test fixtures.
 */

/** Substrings that strongly imply a value is a placeholder, not a real secret. */
const PLACEHOLDER_TOKENS: readonly string[] = [
  'xxxx',
  'your-',
  'your_',
  'yourkey',
  'example',
  'placeholder',
  'changeme',
  'change-me',
  'dummy',
  'sample',
  'redacted',
  'todo',
  'fixme',
  'lorem',
  'foobar',
  '0000',
  '1234',
  'abcd',
  '<',
  '>',
  '{{',
  '}}',
];

/**
 * True when `value` looks like a placeholder rather than a live secret:
 * a known placeholder token, or a single character repeated many times.
 */
export function looksLikePlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  for (const token of PLACEHOLDER_TOKENS) {
    if (lower.includes(token)) {
      return true;
    }
  }
  return /^(.)\1{5,}$/.test(value);
}

/**
 * True when `filename` is an example/sample/test/fixture file where hardcoded
 * secrets are usually intentional and not worth flagging.
 */
export function isExamplePath(filename: string): boolean {
  return /(^|[\\/._-])(example|sample|template|mock|fixture|spec|test)s?([\\/._-]|$)|\.(example|sample|template|dist)$/i.test(
    filename,
  );
}

/** Committed-on-purpose dotenv variants that hold only placeholders, never real secrets. */
const ENV_TEMPLATE_SUFFIXES: readonly string[] = ['.example', '.sample', '.template', '.dist', '.defaults'];

/**
 * True when `filename` is a real, secret-bearing dotenv file: `.env`, `.env.local`,
 * `.env.production`, `app.env`, etc. The template variants above are excluded — secrets
 * belong in a `.env` file, so the extension treats matches here as expected (rendered green).
 * Single source of truth shared by the env-file detection rule and the extension glue.
 */
export function isEnvFile(filename: string): boolean {
  const parts = filename.split(/[\\/]/);
  const name = parts[parts.length - 1].toLowerCase();
  // `*.env` (e.g. `production.env`) — but not a bare file literally named "env".
  if (name.endsWith('.env') && name !== '.env') {
    return true;
  }
  // `.env` or `.env.<something>`, excluding the placeholder templates.
  if (name === '.env' || name.startsWith('.env.')) {
    return !ENV_TEMPLATE_SUFFIXES.some((suffix) => name.endsWith(suffix));
  }
  return false;
}
