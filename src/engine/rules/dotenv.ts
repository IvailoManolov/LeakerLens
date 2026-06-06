import type { Rule } from '../types';
import { maskMiddle } from '../mask';
import { isExamplePath, looksLikePlaceholder } from '../allowlist';

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
