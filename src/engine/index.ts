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
