import type { Rule } from '../types';
import { maskMiddle } from '../mask';
import { looksLikePlaceholder } from '../allowlist';

/** OpenAI API keys: `sk-` (optionally `sk-proj-`) + key body, entropy-gated. */
export const openaiKeyRule: Rule = {
  id: 'openai-api-key',
  name: 'OpenAI API Key',
  severity: 'critical',
  pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  keywords: ['sk-'],
  entropyFloor: 3.2,
  validate: (m) => !looksLikePlaceholder(m.value),
  message: 'Looks like an OpenAI API key.',
  mask: (v) => maskMiddle(v, 5, 4),
};
