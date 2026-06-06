import type { Rule } from '../types';
import { maskMiddle } from '../mask';

/** Anthropic API keys: `sk-ant-` + key body. Listed before the generic OpenAI rule. */
export const anthropicKeyRule: Rule = {
  id: 'anthropic-api-key',
  name: 'Anthropic API Key',
  severity: 'critical',
  pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  keywords: ['sk-ant-'],
  message: 'Looks like an Anthropic API key.',
  mask: (v) => maskMiddle(v, 8, 4),
};
