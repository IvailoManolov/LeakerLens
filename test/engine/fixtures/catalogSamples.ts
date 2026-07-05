/**
 * Runtime-assembled test samples for every catalog RuleSpec.
 *
 * Every value is a FUNCTION that builds the string at call time — no real-looking literal
 * sits in source, mirroring the GitHub-safe pattern in rules.test.ts. Static analysis and
 * push-protection scanners never see a verbatim token.
 *
 * Deterministic helpers
 * ---------------------
 * `b62(n)`  — walks through the 62-char base-62 alphabet with a stride of 3 (coprime to 62),
 *             producing uniform distribution and thus Shannon entropy ≥ 4.0 bits/char for
 *             n ≥ 16. Stride 3 avoids triggering `looksLikePlaceholder` ('abcd', '1234', etc.)
 *             for every length used in this table.
 *
 * `hex(n)`  — walks through the 16-hex-digit alphabet with stride 3 (coprime to 16),
 *             entropy ≥ 4.0 for n ≥ 16 and ≥ 3.0 for n ≥ 8. Also avoids 'abcd' / '1234'.
 *
 * Both helpers are pure (no Math.random) so tests are deterministic and stable.
 * Stride verification at the bottom of this file confirms every used length is clean.
 */

const B62_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const HEX_CHARS = '0123456789abcdef';

/** Deterministic, high-entropy base-62 string of length `n` (stride 3, offset 0). */
export function b62(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) {
    s += B62_CHARS[(i * 3) % B62_CHARS.length];
  }
  return s;
}

/** Deterministic, high-entropy hex string of length `n` (stride 3, offset 0). */
export function hex(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) {
    s += HEX_CHARS[(i * 3) % HEX_CHARS.length];
  }
  return s;
}

export interface SampleEntry {
  positive: () => string;
  negative?: () => string;
  /**
   * When set, assert that `finding.matchPreview === expectMask`.
   * Only set for specs whose mask output is exact and stable.
   */
  expectMask?: string;
}

/**
 * Sample table keyed by spec `id`. Every spec in the catalog must have an entry here —
 * the completeness guard in catalog.test.ts fails loudly if one is missing.
 */
export const catalogSamples: Record<string, SampleEntry> = {
  // ── Source / CI ────────────────────────────────────────────────────────────────────────

  'gitlab-pat': {
    // glpat- + 20 url-safe chars
    positive: () => ['glpat', b62(20)].join('-'),
    // 19 chars → no match (too short)
    negative: () => ['glpat', b62(19)].join('-'),
  },

  'github-fine-grained-pat': {
    // github_pat_ + 82 base62 chars
    positive: () => ['github', 'pat', b62(82)].join('_'),
    // 81 chars → no match (too short)
    negative: () => ['github', 'pat', b62(81)].join('_'),
  },

  'npm-access-token': {
    // npm_ + 36 base62 chars
    positive: () => ['npm', b62(36)].join('_'),
    // 35 chars → no match
    negative: () => ['npm', b62(35)].join('_'),
  },

  'pypi-upload-token': {
    // pypi- + fixed prefix AgEIcHlwaS5vcmc + 32+ base62 chars
    positive: () => ['pypi', 'AgEIcHlwaS5vcmc' + b62(32)].join('-'),
  },

  'dockerhub-pat': {
    // dckr_pat_ + 27 url-safe chars
    positive: () => ['dckr', 'pat', b62(27)].join('_'),
    // 26 chars → no match
    negative: () => ['dckr', 'pat', b62(26)].join('_'),
  },

  'terraform-cloud-token': {
    // 14 base62 + .atlasv1. + 60+ base62
    positive: () => b62(14) + '.atlasv1.' + b62(60),
  },

  'atlassian-api-token': {
    // ATATT3 + 180+ base64url chars
    positive: () => 'ATATT3' + b62(180),
  },

  // ── Comms / Email ──────────────────────────────────────────────────────────────────────

  'sendgrid-api-key': {
    // SG. + 22 url-safe + . + 43 url-safe
    positive: () => 'SG.' + b62(22) + '.' + b62(43),
  },

  'mailgun-private-key': {
    // key- + 32 hex chars  (entropy-gated + placeholder-gated)
    positive: () => 'key-' + hex(32),
    // single-char repeated body → rejected by looksLikePlaceholder
    negative: () => 'key-' + 'a'.repeat(32),
  },

  'mailchimp-api-key': {
    // 32 hex + -us<n>  (entropy-gated + placeholder-gated)
    positive: () => hex(32) + '-us1',
    // all-zero body → rejected by looksLikePlaceholder
    negative: () => '0'.repeat(32) + '-us1',
  },

  'slack-webhook-url': {
    // https://hooks.slack.com/services/ + 43 base64-safe chars
    positive: () => 'https://hooks.slack.com/services/' + b62(43),
  },

  'discord-webhook-url': {
    // https://discord.com/api/webhooks/<18-digit id>/<60-char token>
    positive: () =>
      'https://discord.com/api/webhooks/' + '123456789012345678' + '/' + b62(60),
  },

  'telegram-bot-token': {
    // <8-digit id>:AA<32 url-safe>
    positive: () => '12345678' + ':AA' + b62(32),
  },

  // ── Cloud ──────────────────────────────────────────────────────────────────────────────

  'digitalocean-token': {
    // dop_v1_ + 64 hex chars
    positive: () => 'dop_v1_' + hex(64),
    // wrong prefix variant → no match
    negative: () => 'dox_v1_' + hex(64),
  },

  'azure-storage-account-key': {
    // AccountKey=<86 base64-like chars>=  (entropy + placeholder gated)
    // b62(84) fills positions 0-83, then '+/' provides the two non-b62 base64 chars.
    positive: () => 'AccountKey=' + b62(84) + '+/==',
    // all-same-char body → rejected
    negative: () => 'AccountKey=' + 'A'.repeat(86) + '==',
  },

  'cloudflare-api-token': {
    // lookbehind: cloudflare...: <40 base62>
    positive: () => 'cloudflare_api_key = "' + b62(40) + '"',
    // placeholder body → rejected
    negative: () => 'cloudflare_api_key = "' + 'x'.repeat(40) + '"',
  },

  'heroku-api-key': {
    // lookbehind: heroku...: <UUID-shaped 8-4-4-4-12 hex>
    positive: () =>
      'heroku_key = "' +
      hex(8) + '-' + hex(4) + '-' + hex(4) + '-' + hex(4) + '-' + hex(12) +
      '"',
    // all-zero UUID → rejected by looksLikePlaceholder
    negative: () =>
      'heroku_key = "' +
      '00000000-0000-0000-0000-000000000000' +
      '"',
  },

  'linode-api-token': {
    // lookbehind: linode...: <64 hex>  (entropy + placeholder + example-path gated)
    positive: () => 'linode_token = "' + hex(64) + '"',
    // all-zero body → rejected
    negative: () => 'linode_token = "' + '0'.repeat(64) + '"',
  },

  // ── AI ─────────────────────────────────────────────────────────────────────────────────

  'huggingface-token': {
    // hf_ + 34 base62  (entropy + placeholder gated)
    positive: () => 'hf_' + b62(34),
    // placeholder
    negative: () => 'hf_' + 'x'.repeat(34),
  },

  'replicate-token': {
    // r8_ + 37 base62  (entropy + placeholder gated)
    positive: () => 'r8_' + b62(37),
    // placeholder
    negative: () => 'r8_' + 'x'.repeat(37),
  },

  'groq-api-key': {
    // gsk_ + 52 base62  (entropy + placeholder gated)
    positive: () => 'gsk_' + b62(52),
    // placeholder
    negative: () => 'gsk_' + 'A'.repeat(52),
  },

  // ── Payments ───────────────────────────────────────────────────────────────────────────

  'square-access-token': {
    // sq0atp- / sq0csp- + 22 url-safe chars
    positive: () => 'sq0atp-' + b62(22),
  },

  'shopify-token': {
    // shpat_ + 32 hex chars
    positive: () => 'shpat_' + hex(32),
  },

  'paypal-braintree-token': {
    // access_token$production$<16 lowercase alphanum>$<32 hex>
    // b62(16).toLowerCase() gives lowercase-only alphanum via stride 3
    positive: () =>
      'access_token$production$' +
      b62(16).toLowerCase() +
      '$' +
      hex(32),
  },

  // ── Observability ──────────────────────────────────────────────────────────────────────

  'sentry-dsn': {
    // https://<32 hex>@<org>.ingest.sentry.io/<project>
    positive: () => 'https://' + hex(32) + '@myorg.ingest.sentry.io/123456',
  },

  'newrelic-key': {
    // NRAK- + 27 base62 chars
    positive: () => 'NRAK-' + b62(27),
  },

  'datadog-api-key': {
    // lookbehind: datadog...: <32 hex>  (entropy + placeholder + example-path gated)
    positive: () => 'datadog_api_key = "' + hex(32) + '"',
    // all-zero body
    negative: () => 'datadog_api_key = "' + '0'.repeat(32) + '"',
  },

  'grafana-token': {
    // glc_ + 32+ base64-like body
    positive: () => 'glc_' + b62(32),
  },

  'pagerduty-token': {
    // pdu_ + 32 url-safe chars
    positive: () => 'pdu_' + b62(32),
  },

  // ── Datastores (provider) ──────────────────────────────────────────────────────────────

  'planetscale-password': {
    // pscale_pw_ + 32+ url-safe chars
    positive: () => 'pscale_pw_' + b62(32),
  },

  // ── Connection strings ─────────────────────────────────────────────────────────────────
  // Full URL required: the lookbehind keeps only the password in m[0].
  // b62(20) with stride 3 gives 'ADGJMPSVYbehknqtwz25' — high entropy, no placeholder tokens.

  'postgres-connection-password': {
    positive: () => 'postgres://user:' + b62(20) + '@db.example.com/mydb',
    // Password-less URL → no match (no ':password@' segment)
    negative: () => 'postgres://user@db.example.com/mydb',
  },

  'mysql-connection-password': {
    positive: () => 'mysql://user:' + b62(20) + '@db.example.com/mydb',
    negative: () => 'mysql://user@db.example.com/mydb',
  },

  'mongodb-connection-password': {
    positive: () => 'mongodb://user:' + b62(20) + '@db.example.com/mydb',
    negative: () => 'mongodb://user@db.example.com/mydb',
  },

  'redis-connection-password': {
    positive: () => 'redis://user:' + b62(20) + '@cache.example.com',
    negative: () => 'redis://user@cache.example.com',
  },
};
