import type { Rule } from '../types';
import { maskMiddle } from '../mask';
import { looksLikePlaceholder } from '../allowlist';

/**
 * Generic high-entropy secret assigned to a secret-like name. Context-gated (must
 * follow a `secret`/`token`/`key`/… assignment) and entropy-gated to keep precision high.
 */
export const highEntropyAssignmentRule: Rule = {
  id: 'high-entropy-secret',
  name: 'High-entropy Secret',
  severity: 'medium',
  pattern:
    /(?<=(?:secret|token|api[_-]?key|apikey|password|passwd|auth|credential|access[_-]?key)["']?\s*[:=]\s*["'])[^"'\s]{20,}(?=["'])/gi,
  keywords: ['secret', 'token', 'key', 'password', 'passwd', 'auth', 'credential'],
  entropyFloor: 3.5,
  validate: (m) => !looksLikePlaceholder(m.value),
  message: 'A high-entropy value assigned to a secret-like name — likely a hardcoded credential.',
  mask: (v) => maskMiddle(v, 3, 3),
};
