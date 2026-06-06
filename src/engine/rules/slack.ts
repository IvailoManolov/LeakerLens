import type { Rule } from '../types';
import { maskMiddle } from '../mask';

/** Slack tokens: `xoxb`/`xoxa`/`xoxp`/`xoxr`/`xoxs` + token body. */
export const slackTokenRule: Rule = {
  id: 'slack-token',
  name: 'Slack Token',
  severity: 'high',
  pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
  keywords: ['xox'],
  message: 'Looks like a Slack API token.',
  mask: (v) => maskMiddle(v, 5, 2),
};
