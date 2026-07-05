// Patterns adapted from gitleaks (MIT). See ./CREDITS.md.
import type { RuleSpec } from '../define';

/**
 * AI / ML provider tokens (HuggingFace, Replicate, Groq). Fixed prefixes carry the
 * precision; the loose bodies add an entropy floor + placeholder gate where needed.
 */
export const aiSpecs: readonly RuleSpec[] = [
  {
    id: 'huggingface-token',
    name: 'HuggingFace Access Token',
    severity: 'high',
    // `hf_` + 34 base62 chars. Loose body → entropy + placeholder gate.
    pattern: /\bhf_[0-9A-Za-z]{34}\b/g,
    keywords: ['hf_'],
    entropyFloor: 3.0,
    gatePlaceholder: true,
    mask: { kind: 'prefix', head: 3 },
    message: 'Looks like a HuggingFace access token.',
  },
  {
    id: 'replicate-token',
    name: 'Replicate API Token',
    severity: 'high',
    // `r8_` + 37 base62 chars. Loose body → entropy + placeholder gate.
    pattern: /\br8_[0-9A-Za-z]{37}\b/g,
    keywords: ['r8_'],
    entropyFloor: 3.0,
    gatePlaceholder: true,
    mask: { kind: 'prefix', head: 3 },
    message: 'Looks like a Replicate API token.',
  },
  {
    id: 'groq-api-key',
    name: 'Groq API Key',
    severity: 'high',
    // `gsk_` + 52 base62 chars (Groq key shape).
    pattern: /\bgsk_[0-9A-Za-z]{52}\b/g,
    keywords: ['gsk_'],
    entropyFloor: 3.0,
    gatePlaceholder: true,
    mask: { kind: 'prefix', head: 4 },
    message: 'Looks like a Groq API key.',
  },
];
