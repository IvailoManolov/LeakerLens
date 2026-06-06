import type { Rule } from '../types';
import { maskPrefix } from '../mask';

/** AWS Access Key IDs: `AKIA`/`ASIA` followed by 16 uppercase alphanumerics. */
export const awsAccessKeyRule: Rule = {
  id: 'aws-access-key-id',
  name: 'AWS Access Key ID',
  severity: 'critical',
  pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  keywords: ['AKIA', 'ASIA'],
  message: 'Looks like an AWS Access Key ID — it can authenticate against your AWS account.',
  mask: (v) => maskPrefix(v, 4),
};
