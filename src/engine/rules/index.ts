import type { Ruleset } from '../types';
import { awsAccessKeyRule } from './aws';
import { gcpApiKeyRule } from './gcp';
import { githubTokenRule } from './github';
import { stripeKeyRule } from './stripe';
import { anthropicKeyRule } from './anthropic';
import { openaiKeyRule } from './openai';
import { slackTokenRule } from './slack';
import { jwtRule } from './jwt';
import { privateKeyRule } from './private-key';
import { highEntropyAssignmentRule } from './high-entropy';
import { dotenvLeakRule, dotenvFileValueRule } from './dotenv';

/**
 * The bundled headline ruleset. Order matters: specific high-confidence rules come
 * first so that, when two rules match the same span, the more specific one wins the
 * overlap-dedupe in {@link scanText} (V8's sort is stable). Anthropic precedes the
 * broader OpenAI `sk-` rule for the same reason.
 */
export const DEFAULT_RULESET: Ruleset = {
  rules: [
    awsAccessKeyRule,
    gcpApiKeyRule,
    githubTokenRule,
    stripeKeyRule,
    anthropicKeyRule,
    openaiKeyRule,
    slackTokenRule,
    jwtRule,
    privateKeyRule,
    highEntropyAssignmentRule,
    dotenvLeakRule,
    dotenvFileValueRule,
  ],
};
