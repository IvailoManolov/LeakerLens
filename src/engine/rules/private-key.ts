import type { Rule } from '../types';

/** PEM private-key blocks (RSA/EC/DSA/OpenSSH/PGP or generic). */
export const privateKeyRule: Rule = {
  id: 'private-key',
  name: 'Private Key',
  severity: 'critical',
  pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  keywords: ['PRIVATE KEY'],
  message: 'A private key block is embedded in source — keys belong in a secret store.',
  mask: () => '-----BEGIN PRIVATE KEY----- (hidden)',
  // A PEM block can't be swapped for an env reference inline, so only offer ignore/mask.
  remediations: ['ignore', 'mask'],
};
