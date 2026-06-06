import type { Rule } from '../types';
import { maskPrefix } from '../mask';

/** GitHub tokens: `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_` + 36 alphanumerics. */
export const githubTokenRule: Rule = {
  id: 'github-token',
  name: 'GitHub Token',
  severity: 'critical',
  pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36}\b/g,
  keywords: ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_'],
  message: 'Looks like a GitHub access token.',
  mask: (v) => maskPrefix(v, 7),
};
