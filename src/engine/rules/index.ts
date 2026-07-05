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
import { defineRule } from './define';
import { catalogProviderSpecs, connectionStringSpecs } from './catalog';

/**
 * The bundled headline ruleset. Order matters: specific high-confidence rules come
 * first so that, when two rules match the same span, the more specific one wins the
 * overlap-dedupe in {@link scanText} (V8's sort is stable). Anthropic precedes the
 * broader OpenAI `sk-` rule for the same reason.
 *
 * The catalog block sits in the middle, preserving the specific-first / generic-last law:
 *   1. bespoke specific rules (aws…privateKey) — UNCHANGED,
 *   2. fixed-prefix provider rules from the declarative catalog,
 *   3. connection-string rules (medium, hard-gated) — highest FP risk, after the providers,
 *   4. the generic/contextual rules (high-entropy + the two dotenv rules) — UNCHANGED, last.
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
    ...catalogProviderSpecs.map(defineRule),
    ...connectionStringSpecs.map(defineRule),
    highEntropyAssignmentRule,
    dotenvLeakRule,
    dotenvFileValueRule,
  ],
};
