// Patterns adapted from gitleaks (MIT). See ./CREDITS.md.
import type { RuleSpec } from '../define';

/**
 * Payment / commerce platform tokens (Square, Shopify, PayPal/Braintree). Money-moving
 * account-wide credentials → `critical`; storefront/app tokens → `high`. All have fixed
 * unguessable prefixes, so the prefix is the precision.
 */
export const paymentsSpecs: readonly RuleSpec[] = [
  {
    id: 'square-access-token',
    name: 'Square Access Token',
    severity: 'critical',
    // `sq0atp-` (production access) / `sq0csp-` (OAuth client secret) + 22 url-safe chars.
    pattern: /\bsq0(?:atp|csp)-[0-9A-Za-z_-]{22}\b/g,
    keywords: ['sq0atp-', 'sq0csp-'],
    mask: { kind: 'prefix', head: 7 },
    message: 'Looks like a Square access token — it can move money on your account.',
  },
  {
    id: 'shopify-token',
    name: 'Shopify Token',
    severity: 'critical',
    // `shpat_` (admin) / `shpss_` (shared secret) / `shpca_` (custom app) + 32 hex chars.
    pattern: /\bshp(?:at|ss|ca|pa)_[0-9a-fA-F]{32}\b/g,
    keywords: ['shpat_', 'shpss_', 'shpca_', 'shppa_'],
    mask: { kind: 'prefix', head: 6 },
    message: 'Looks like a Shopify access token — it can read orders and customer data.',
  },
  {
    id: 'paypal-braintree-token',
    name: 'PayPal/Braintree Access Token',
    severity: 'critical',
    // Braintree access token: `access_token$production$<32 hex>$<32 hex>`.
    pattern: /\baccess_token\$(?:production|sandbox)\$[0-9a-z]{16}\$[0-9a-f]{32}\b/g,
    keywords: ['access_token$production', 'access_token$sandbox'],
    mask: { kind: 'middle', head: 12, tail: 4 },
    message: 'Looks like a Braintree/PayPal access token — it can move money on your account.',
  },
];
