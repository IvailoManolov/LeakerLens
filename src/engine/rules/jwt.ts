import type { Rule } from '../types';
import { maskMiddle } from '../mask';

/** JSON Web Tokens: three base64url segments separated by dots, starting `eyJ`. */
export const jwtRule: Rule = {
  id: 'jwt',
  name: 'JSON Web Token',
  severity: 'medium',
  pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  keywords: ['eyJ'],
  message: 'Looks like a JWT — it may embed credentials or grant access.',
  mask: (v) => maskMiddle(v, 6, 4),
};
