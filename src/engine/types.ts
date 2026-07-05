/**
 * LeakLens detection contract.
 *
 * These types are the stable interface between the pure `engine/` and the VS Code
 * `extension/` glue. The engine produces {@link Finding}s; the extension renders them.
 * Nothing here imports `vscode` — the engine must stay portable and testable.
 */

/** Relative risk of a finding, used for sorting and color. */
export type Severity = 'critical' | 'high' | 'medium' | 'low';

/** The remediations the UI can offer for a finding. */
export type RemediationKind = 'ignore' | 'mask' | 'moveToEnv';

/** A single offered fix, with a human-readable label. */
export interface Remediation {
  readonly kind: RemediationKind;
  readonly title: string;
}

/**
 * One detected secret. Offsets are absolute UTF-16 code-unit indices into the scanned
 * text (`end` exclusive) so the extension can build a `vscode.Range` precisely.
 */
export interface Finding {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly severity: Severity;
  readonly start: number;
  readonly end: number;
  /** 0-based line of `start`. */
  readonly line: number;
  /** 0-based column of `start`. */
  readonly column: number;
  /** Masked, safe-to-display preview of the matched value. */
  readonly matchPreview: string;
  /** Stable, non-reversible hash of the raw matched value; identical secrets share it. */
  readonly fingerprint: string;
  /** Shannon entropy of the matched value when entropy-gated; otherwise omitted. */
  readonly entropy?: number;
  /** Short, calm explanation for the hover / diagnostic. */
  readonly message: string;
  readonly remediations: readonly Remediation[];
}

/** A raw regex hit handed to a rule's validator/mask. */
export interface RuleMatch {
  readonly value: string;
  readonly start: number;
  readonly end: number;
  readonly groups?: Record<string, string>;
}

/** Context passed to validators (filename-based gating, etc.). */
export interface ScanContext {
  readonly filename: string;
}

/**
 * A detection rule. Rules are pure data + small pure functions. Add cheap `keywords`
 * to skip the regex entirely when none are present — the hot-path optimization.
 */
export interface Rule {
  readonly id: string;
  readonly name: string;
  readonly severity: Severity;
  /** Must be a global (`g`) regex with capture group 1 = the secret, or whole match. */
  readonly pattern: RegExp;
  /** If set, the regex is only run when one of these substrings is present. */
  readonly keywords?: readonly string[];
  /** Minimum Shannon entropy (bits/char) of the captured secret to keep the match. */
  readonly entropyFloor?: number;
  /** Return `false` to drop a match (false-positive gate). */
  readonly validate?: (match: RuleMatch, ctx: ScanContext) => boolean;
  /** Short, calm hover/diagnostic message for this rule. */
  readonly message: string;
  /** Build the masked preview shown to the user. */
  readonly mask: (value: string) => string;
  /** Remediations offered for this rule (defaults applied in scan if omitted). */
  readonly remediations?: readonly RemediationKind[];
}

/** An ordered collection of rules. */
export interface Ruleset {
  readonly rules: readonly Rule[];
}

/** Options for {@link scanText}. */
export interface ScanOptions {
  readonly filename: string;
  /** Defaults to the bundled `DEFAULT_RULESET`. */
  readonly ruleset?: Ruleset;
}
