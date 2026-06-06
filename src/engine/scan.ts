/**
 * The detection core. `scanText` is pure and synchronous — no `vscode`, no I/O, no
 * clock, no randomness — so it is trivially unit-testable and reusable (e.g. a future
 * CLI or the git pre-commit guard).
 */
import { DEFAULT_RULESET } from './rules';
import { shannonEntropy } from './entropy';
import type {
  Finding,
  Remediation,
  RemediationKind,
  Rule,
  RuleMatch,
  ScanContext,
  ScanOptions,
  Severity,
} from './types';

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const REMEDIATION_TITLES: Record<RemediationKind, string> = {
  ignore: 'Ignore here',
  mask: 'Mask value',
  moveToEnv: 'Move to .env',
};

const DEFAULT_REMEDIATION_KINDS: readonly RemediationKind[] = ['ignore', 'mask', 'moveToEnv'];

/** Inline suppression marker: a finding on a line containing this is dropped. */
export const IGNORE_MARKER = 'leaklens:ignore';

/** Offsets of the first character of each line (line 0 starts at 0). */
function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      starts.push(i + 1);
    }
  }
  return starts;
}

/** Greatest line index whose start offset is `<= index` (binary search). */
function lineAt(lineStarts: number[], index: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= index) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

function buildRemediations(kinds: readonly RemediationKind[]): Remediation[] {
  return kinds.map((kind) => ({ kind, title: REMEDIATION_TITLES[kind] }));
}

/** True if any keyword (case-insensitive) is present — the cheap pre-filter. */
function hasKeyword(lowerText: string, keywords: readonly string[]): boolean {
  for (const kw of keywords) {
    if (lowerText.includes(kw.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/** Run one rule across `text`, pushing surviving matches into `out`. */
function collectMatches(
  text: string,
  rule: Rule,
  ctx: ScanContext,
  lineStarts: number[],
  out: Finding[],
): void {
  // Clone so the shared rule's regex `lastIndex` is never mutated across scans.
  const re = new RegExp(rule.pattern.source, rule.pattern.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = m[0];
    const start = m.index;
    const end = start + value.length;
    const match: RuleMatch = { value, start, end };

    let entropy: number | undefined;
    if (rule.entropyFloor !== undefined) {
      entropy = shannonEntropy(value);
      if (entropy < rule.entropyFloor) {
        continue;
      }
    }
    if (rule.validate && !rule.validate(match, ctx)) {
      continue;
    }

    const line = lineAt(lineStarts, start);
    const finding: Finding = {
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      start,
      end,
      line,
      column: start - lineStarts[line],
      matchPreview: rule.mask(value),
      message: rule.message,
      remediations: buildRemediations(rule.remediations ?? DEFAULT_REMEDIATION_KINDS),
      ...(entropy !== undefined ? { entropy } : {}),
    };
    out.push(finding);
  }
}

/**
 * Keep only non-overlapping findings. Sorted by start, then longest, then most severe,
 * so the most specific/severe finding wins any overlap (e.g. an AWS key beats the
 * generic high-entropy match over the same span).
 */
function compareFindings(a: Finding, b: Finding): number {
  if (a.start !== b.start) {
    return a.start - b.start;
  }
  if (a.severity !== b.severity) {
    return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  }
  return b.end - a.end;
}

function dedupeOverlaps(findings: Finding[]): Finding[] {
  findings.sort(compareFindings);
  const kept: Finding[] = [];
  let lastEnd = -1;
  for (const f of findings) {
    if (f.start >= lastEnd) {
      kept.push(f);
      lastEnd = f.end;
    }
  }
  return kept;
}

/** Drop findings on lines carrying the inline `leaklens:ignore` marker. */
function suppressIgnored(findings: Finding[], text: string, lineStarts: number[]): Finding[] {
  if (!text.includes(IGNORE_MARKER)) {
    return findings;
  }
  return findings.filter((f) => {
    const lineStart = lineStarts[f.line];
    const lineEnd = f.line + 1 < lineStarts.length ? lineStarts[f.line + 1] : text.length;
    return !text.slice(lineStart, lineEnd).includes(IGNORE_MARKER);
  });
}

/**
 * Scan `text` for secrets. Pure, synchronous, deterministic.
 *
 * @param text The document contents.
 * @param opts Filename context and an optional custom ruleset.
 * @returns Non-overlapping findings, sorted by position.
 */
export function scanText(text: string, opts: ScanOptions): Finding[] {
  const ruleset = opts.ruleset ?? DEFAULT_RULESET;
  const ctx: ScanContext = { filename: opts.filename };
  const lowerText = text.toLowerCase();
  const lineStarts = computeLineStarts(text);
  const findings: Finding[] = [];

  for (const rule of ruleset.rules) {
    if (rule.keywords && !hasKeyword(lowerText, rule.keywords)) {
      continue;
    }
    collectMatches(text, rule, ctx, lineStarts, findings);
  }

  if (findings.length === 0) {
    return findings;
  }
  return suppressIgnored(dedupeOverlaps(findings), text, lineStarts);
}
