// Patterns adapted from gitleaks (MIT). See ./CREDITS.md.
import type { RuleSpec } from '../define';
import { sourceCiSpecs } from './source-ci';
import { commsSpecs } from './comms';
import { cloudSpecs } from './cloud';
import { aiSpecs } from './ai';
import { paymentsSpecs } from './payments';
import { observabilitySpecs } from './observability';
import { datastoreProviderSpecs, connectionStringSpecs } from './datastores';

export {
  sourceCiSpecs,
  commsSpecs,
  cloudSpecs,
  aiSpecs,
  paymentsSpecs,
  observabilitySpecs,
  datastoreProviderSpecs,
  connectionStringSpecs,
};

/**
 * Fixed-prefix provider specs (everything except the connection-string family). These run
 * BEFORE the connection-string specs and BEFORE the generic/contextual rules, preserving the
 * specific-first ordering law.
 */
export const catalogProviderSpecs: readonly RuleSpec[] = [
  ...sourceCiSpecs,
  ...commsSpecs,
  ...cloudSpecs,
  ...aiSpecs,
  ...paymentsSpecs,
  ...observabilitySpecs,
  ...datastoreProviderSpecs,
];
