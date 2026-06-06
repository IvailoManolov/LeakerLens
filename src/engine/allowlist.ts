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
