import { createPublicKey, verify } from 'crypto';

/**
 * Offline license verification. A key is `base64url(payload).base64url(signature)`,
 * signed (Ed25519) by the LeakLens private key; we verify with the bundled public key.
 * No network call is ever made — a valid key works on a plane (Principle 1).
 *
 * The public key below is a placeholder for the v1 seam; swap in the real distribution
 * key before publishing. Verification fails closed (returns free) for any unknown key.
 */
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE=
-----END PUBLIC KEY-----`;

/** Decoded, verified license claims. */
export interface LicensePayload {
  /** Subject — typically the buyer's email or order id. */
  readonly sub: string;
  readonly tier: 'pro';
  /** Optional expiry, seconds since epoch. */
  readonly exp?: number;
}

/**
 * Verify a license key. Returns the payload when the signature is valid and unexpired,
 * otherwise `null`. Never throws.
 */
export function verifyLicenseKey(key: string, nowSeconds: number): LicensePayload | null {
  try {
    const dot = key.indexOf('.');
    if (dot <= 0) {
      return null;
    }
    const body = key.slice(0, dot);
    const sig = key.slice(dot + 1);
    if (sig.length === 0) {
      return null;
    }
    const ok = verify(null, Buffer.from(body), createPublicKey(PUBLIC_KEY_PEM), Buffer.from(sig, 'base64url'));
    if (!ok) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LicensePayload;
    if (payload.tier !== 'pro') {
      return null;
    }
    if (payload.exp !== undefined && payload.exp < nowSeconds) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
