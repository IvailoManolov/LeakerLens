import type { Rule } from '../types';
import { maskPrefix } from '../mask';

/** Google/GCP API keys: `AIza` + 35 url-safe characters. */
export const gcpApiKeyRule: Rule = {
  id: 'gcp-api-key',
  name: 'Google API Key',
  severity: 'high',
  pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  keywords: ['AIza'],
  message: 'Looks like a Google/GCP API key.',
  mask: (v) => maskPrefix(v, 6),
};
