import type { Rule } from '../types';
import { maskMiddle } from '../mask';

/** Stripe secret/restricted keys: `sk_`/`rk_` + `live`/`test` + key body. */
export const stripeKeyRule: Rule = {
  id: 'stripe-secret-key',
  name: 'Stripe Secret Key',
  severity: 'critical',
  pattern: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/g,
  keywords: ['sk_live', 'sk_test', 'rk_live', 'rk_test'],
  message: 'Looks like a Stripe secret key — it can move money and read customer data.',
  mask: (v) => maskMiddle(v, 8, 2),
};
