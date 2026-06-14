/**
 * The declarative rule factory. Catalog rules are pure *data* ({@link RuleSpec}) compiled
 * into {@link Rule}s by {@link defineRule}. A `RegExp` is data, not code, so adding patterns
 * costs zero branch coverage — every coverage-bearing branch (mask selection, validate
 * composition) lives here, exercised once by the factory's own tests.
 *
 * The factory deliberately accepts **no arbitrary closures**: `mask` is a small finite
 * struct and `validate` is two boolean flags, so the branch set is closed and finite.
 * Anything that needs custom mask/validate logic is a bespoke rule, not a catalog entry.
 */
import type { RemediationKind, RuleMatch, ScanContext, Rule, Severity } from '../types';
import { maskAll, maskMiddle, maskPrefix } from '../mask';
import { isExamplePath, looksLikePlaceholder } from '../allowlist';

/** How a catalog rule masks its matched value. Defaults: prefix head 4, middle 4/4. */
export interface MaskSpec {
  readonly kind: 'prefix' | 'middle' | 'all';
  /** Leading chars kept by `prefix`/`middle` (default 4). */
  readonly head?: number;
  /** Trailing chars kept by `middle` (default 4). */
  readonly tail?: number;
}

/**
 * A declarative detection rule. Pure data — no closures — so the catalog can grow without
 * touching the factory's (coverage-bearing) branches. `keywords` is REQUIRED at the type
 * level: every catalog rule must carry the cheap hot-path pre-filter (the perf gate).
 */
export interface RuleSpec {
  readonly id: string;
  readonly name: string;
  readonly severity: Severity;
  /** Global regex; group 0 (or a lookbehind/lookahead-narrowed match) = the secret. */
  readonly pattern: RegExp;
  /** Cheap substrings (few + long) that gate the regex on the hot path. Required. */
  readonly keywords: readonly string[];
  /** Minimum Shannon entropy of the matched secret; omitted when the prefix alone suffices. */
  readonly entropyFloor?: number;
  readonly mask: MaskSpec;
  /** Drop matches whose value looks like a placeholder (e.g. `your-key-here`). */
  readonly gatePlaceholder?: boolean;
  /** Drop matches in example/sample/test/fixture files. */
  readonly gateExamplePath?: boolean;
  readonly message: string;
  readonly remediations?: readonly RemediationKind[];
}

/** Default leading chars kept by `prefix`/`middle` masks. */
const DEFAULT_HEAD = 4;
/** Default trailing chars kept by the `middle` mask. */
const DEFAULT_TAIL = 4;

/** Build the `Rule.mask` function from the declarative {@link MaskSpec}. */
function buildMask(spec: MaskSpec): (value: string) => string {
  const head = spec.head ?? DEFAULT_HEAD;
  const tail = spec.tail ?? DEFAULT_TAIL;
  switch (spec.kind) {
    case 'prefix':
      return (v) => maskPrefix(v, head);
    case 'middle':
      return (v) => maskMiddle(v, head, tail);
    case 'all':
      return maskAll;
  }
}

/**
 * Build the `Rule.validate` from the gate flags, or `undefined` when neither is set (so the
 * hot path skips the validator call entirely). The composed validator short-circuits on the
 * first failing gate.
 */
function buildValidate(
  gatePlaceholder: boolean,
  gateExamplePath: boolean,
): ((match: RuleMatch, ctx: ScanContext) => boolean) | undefined {
  if (!gatePlaceholder && !gateExamplePath) {
    return undefined;
  }
  return (match: RuleMatch, ctx: ScanContext): boolean => {
    if (gatePlaceholder && looksLikePlaceholder(match.value)) {
      return false;
    }
    if (gateExamplePath && isExamplePath(ctx.filename)) {
      return false;
    }
    return true;
  };
}

/**
 * Compile a declarative {@link RuleSpec} into an executable {@link Rule}. Optional fields
 * (`entropyFloor`, `remediations`, `validate`) are copied through only when present, so the
 * resulting rule stays minimal and the scan hot path skips absent stages.
 */
export function defineRule(spec: RuleSpec): Rule {
  const validate = buildValidate(spec.gatePlaceholder ?? false, spec.gateExamplePath ?? false);
  return {
    id: spec.id,
    name: spec.name,
    severity: spec.severity,
    pattern: spec.pattern,
    keywords: spec.keywords,
    message: spec.message,
    mask: buildMask(spec.mask),
    ...(spec.entropyFloor !== undefined ? { entropyFloor: spec.entropyFloor } : {}),
    ...(validate !== undefined ? { validate } : {}),
    ...(spec.remediations !== undefined ? { remediations: spec.remediations } : {}),
  };
}
