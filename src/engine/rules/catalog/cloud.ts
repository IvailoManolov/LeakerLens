// Patterns adapted from gitleaks (MIT). See ./CREDITS.md.
import type { RuleSpec } from '../define';

/**
 * Cloud-platform tokens (DigitalOcean, Azure Storage, Cloudflare, Heroku, Linode). Fixed
 * prefixes carry their own precision; the loose ones (Cloudflare/Heroku hex, Azure account
 * key blob) add an entropy floor + placeholder gate.
 */
export const cloudSpecs: readonly RuleSpec[] = [
  {
    id: 'digitalocean-token',
    name: 'DigitalOcean Token',
    severity: 'high',
    // `dop_v1_` (PAT) / `doo_v1_` (OAuth) / `dor_v1_` (refresh) + 64 hex chars.
    pattern: /\bdo[oprt]_v1_[0-9a-f]{64}\b/g,
    keywords: ['dop_v1_', 'doo_v1_', 'dor_v1_'],
    mask: { kind: 'prefix', head: 7 },
    message: 'Looks like a DigitalOcean API token.',
  },
  {
    id: 'azure-storage-account-key',
    name: 'Azure Storage Account Key',
    severity: 'critical',
    // Lookbehind on `AccountKey=` so group 0 is the 88-char base64 key (engine masks group 0).
    pattern: /(?<=AccountKey=)[0-9A-Za-z+/]{86}==/g,
    keywords: ['AccountKey='],
    entropyFloor: 3.5,
    gatePlaceholder: true,
    mask: { kind: 'middle', head: 4, tail: 4 },
    message: 'Looks like an Azure Storage account key — it grants full access to the account.',
  },
  {
    id: 'cloudflare-api-token',
    name: 'Cloudflare API Token',
    severity: 'high',
    // Lookbehind on a `cloudflare`-context assignment → group 0 is the 40-char token body.
    pattern: /(?<=cloudflare[^\n]{0,40}["']?[:=]\s*["']?)[0-9A-Za-z_-]{40}\b/gi,
    keywords: ['cloudflare'],
    entropyFloor: 3.5,
    gatePlaceholder: true,
    gateExamplePath: true,
    mask: { kind: 'middle', head: 4, tail: 4 },
    message: 'Looks like a Cloudflare API token.',
  },
  {
    id: 'heroku-api-key',
    name: 'Heroku API Key',
    severity: 'high',
    // Lookbehind on a `heroku`-context assignment → group 0 is the UUID-shaped key.
    pattern:
      /(?<=heroku[^\n]{0,30}["']?[:=]\s*["']?)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    keywords: ['heroku'],
    gatePlaceholder: true,
    gateExamplePath: true,
    mask: { kind: 'middle', head: 4, tail: 4 },
    message: 'Looks like a Heroku API key.',
  },
  {
    id: 'linode-api-token',
    name: 'Linode API Token',
    severity: 'high',
    // Lookbehind on a `linode`-context assignment → group 0 is the 64-char hex token.
    pattern: /(?<=linode[^\n]{0,30}["']?[:=]\s*["']?)[0-9a-f]{64}\b/gi,
    keywords: ['linode'],
    entropyFloor: 3.0,
    gatePlaceholder: true,
    gateExamplePath: true,
    mask: { kind: 'middle', head: 4, tail: 4 },
    message: 'Looks like a Linode API token.',
  },
];
