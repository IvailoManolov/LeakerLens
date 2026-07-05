import type { Rule } from '../types';
import { maskMiddle } from '../mask';
import { isEnvFile, isExamplePath, looksLikePlaceholder } from '../allowlist';

/**
 * A secret-looking value hardcoded against an UPPER_SNAKE env-var name (e.g.
 * `DATABASE_PASSWORD = "…"`) — the classic `.env` value leaking into source.
 * Entropy-gated, placeholder-gated, and skipped in example/test files.
 */
export const dotenvLeakRule: Rule = {
  id: 'dotenv-value-leak',
  name: 'Hardcoded Env Secret',
  severity: 'medium',
  pattern: /(?<=\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\s*[:=]\s*["'])[^"'\s]{16,}(?=["'])/g,
  entropyFloor: 3.3,
  validate: (m, ctx) => !looksLikePlaceholder(m.value) && !isExamplePath(ctx.filename),
  message: 'A secret-looking value is hardcoded where an environment variable belongs.',
  mask: (v) => maskMiddle(v, 3, 3),
};

/**
 * A secret value on an assignment line *inside an actual `.env` file* — `KEY=value`,
 * typically unquoted, which the quoted-only {@link dotenvLeakRule} never sees. Gated to env
 * files (via {@link isEnvFile}) so it adds zero false positives in source code; the extension
 * renders these green, since a secret in `.env` is exactly where it belongs.
 */
export const dotenvFileValueRule: Rule = {
  id: 'dotenv-file-value',
  name: 'Env Secret',
  severity: 'medium',
  pattern: /(?<=^[ \t]*(?:export[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*=[ \t]*)[^\s"'#][^\s]{15,}/gm,
  entropyFloor: 3.3,
  validate: (m, ctx) => isEnvFile(ctx.filename) && !looksLikePlaceholder(m.value),
  message: 'A secret value stored in this .env file.',
  mask: (v) => maskMiddle(v, 3, 3),
  // 'moveToEnv' is meaningless inside a `.env` file — offer only ignore/mask.
  remediations: ['ignore', 'mask'],
};
