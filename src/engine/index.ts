/**
 * Public surface of the pure detection engine. The extension imports only from here.
 * Nothing in `engine/` imports `vscode`.
 */
export { scanText, IGNORE_MARKER } from './scan';
export { shannonEntropy } from './entropy';
export { fingerprint } from './fingerprint';
export { maskAll, maskMiddle, maskPrefix } from './mask';
export { isExamplePath, looksLikePlaceholder, isEnvFile } from './allowlist';
export { DEFAULT_RULESET } from './rules';
export { defineRule } from './rules/define';
export type { RuleSpec, MaskSpec } from './rules/define';
export {
  sourceCiSpecs,
  commsSpecs,
  cloudSpecs,
  aiSpecs,
  paymentsSpecs,
  observabilitySpecs,
  datastoreProviderSpecs,
  connectionStringSpecs,
  catalogProviderSpecs,
} from './rules/catalog';
export type {
  Finding,
  Remediation,
  RemediationKind,
  Rule,
  RuleMatch,
  Ruleset,
  ScanContext,
  ScanOptions,
  Severity,
} from './types';
