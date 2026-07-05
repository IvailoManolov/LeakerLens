/**
 * Unit tests for `src/engine/rules/define.ts` — drives every branch to 100% coverage.
 *
 * Strategy: call `defineRule(spec)` with hand-crafted specs that exercise each decision
 * point in isolation. No `vscode` imports anywhere — the factory is pure engine code.
 */
import { describe, expect, it } from 'vitest';
import { defineRule } from '../../src/engine/rules/define';
import type { RuleSpec } from '../../src/engine/rules/define';
import { maskPrefix, maskMiddle, maskAll } from '../../src/engine/mask';
import type { RuleMatch, ScanContext } from '../../src/engine/types';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** A minimal valid RuleSpec with the given overrides applied on top. */
function spec(overrides: Partial<RuleSpec> & Pick<RuleSpec, 'id' | 'mask'>): RuleSpec {
  return {
    id: overrides.id,
    name: overrides.name ?? 'Test Rule',
    severity: overrides.severity ?? 'high',
    pattern: overrides.pattern ?? /test-[0-9A-Za-z]{8}/g,
    keywords: overrides.keywords ?? ['test-'],
    mask: overrides.mask,
    message: overrides.message ?? 'Test message',
    ...(overrides.entropyFloor !== undefined ? { entropyFloor: overrides.entropyFloor } : {}),
    ...(overrides.gatePlaceholder !== undefined ? { gatePlaceholder: overrides.gatePlaceholder } : {}),
    ...(overrides.gateExamplePath !== undefined ? { gateExamplePath: overrides.gateExamplePath } : {}),
    ...(overrides.remediations !== undefined ? { remediations: overrides.remediations } : {}),
  };
}

const CLEAN_MATCH: RuleMatch = { value: 'aZ9kP3xR', start: 0, end: 8 };
const CLEAN_CTX: ScanContext = { filename: 'src/app.ts' };
const EXAMPLE_CTX: ScanContext = { filename: 'src/example.ts' };

// ─── mask.kind = 'prefix' ─────────────────────────────────────────────────────

describe('defineRule — mask.kind = prefix', () => {
  it('uses DEFAULT_HEAD (4) when head is omitted', () => {
    const rule = defineRule(spec({ id: 'p1', mask: { kind: 'prefix' } }));
    const value = 'abcdefghij';
    expect(rule.mask(value)).toBe(maskPrefix(value, 4));
  });

  it('uses explicit head when provided', () => {
    const rule = defineRule(spec({ id: 'p2', mask: { kind: 'prefix', head: 6 } }));
    const value = 'abcdefghij';
    expect(rule.mask(value)).toBe(maskPrefix(value, 6));
  });
});

// ─── mask.kind = 'middle' ─────────────────────────────────────────────────────

describe('defineRule — mask.kind = middle', () => {
  it('uses DEFAULT_HEAD=4 / DEFAULT_TAIL=4 when both are omitted', () => {
    const rule = defineRule(spec({ id: 'm1', mask: { kind: 'middle' } }));
    const value = 'abcdefghijklmnop';
    expect(rule.mask(value)).toBe(maskMiddle(value, 4, 4));
  });

  it('uses explicit head and tail when provided', () => {
    const rule = defineRule(spec({ id: 'm2', mask: { kind: 'middle', head: 6, tail: 3 } }));
    const value = 'abcdefghijklmnop';
    expect(rule.mask(value)).toBe(maskMiddle(value, 6, 3));
  });
});

// ─── mask.kind = 'all' ────────────────────────────────────────────────────────

describe('defineRule — mask.kind = all', () => {
  it('fully masks the value regardless of head/tail', () => {
    const rule = defineRule(spec({ id: 'a1', mask: { kind: 'all' } }));
    const value = 'supersecretvalue';
    expect(rule.mask(value)).toBe(maskAll(value));
    expect(rule.mask(value)).toBe('*'.repeat(value.length));
  });
});

// ─── entropyFloor ─────────────────────────────────────────────────────────────

describe('defineRule — entropyFloor', () => {
  it('copies entropyFloor when present', () => {
    const rule = defineRule(spec({ id: 'ef1', mask: { kind: 'prefix' }, entropyFloor: 3.5 }));
    expect(rule.entropyFloor).toBe(3.5);
  });

  it('leaves entropyFloor undefined when absent', () => {
    const rule = defineRule(spec({ id: 'ef2', mask: { kind: 'prefix' } }));
    expect(rule.entropyFloor).toBeUndefined();
  });
});

// ─── remediations ─────────────────────────────────────────────────────────────

describe('defineRule — remediations', () => {
  it('copies remediations when present', () => {
    const rule = defineRule(
      spec({ id: 'r1', mask: { kind: 'prefix' }, remediations: ['ignore', 'mask'] }),
    );
    expect(rule.remediations).toEqual(['ignore', 'mask']);
  });

  it('leaves remediations undefined when absent', () => {
    const rule = defineRule(spec({ id: 'r2', mask: { kind: 'prefix' } }));
    expect(rule.remediations).toBeUndefined();
  });
});

// ─── gate combinations ────────────────────────────────────────────────────────

describe('defineRule — gate: neither flag', () => {
  it('produces no validate function when both gates are false/absent', () => {
    const rule = defineRule(spec({ id: 'g1', mask: { kind: 'prefix' } }));
    expect(rule.validate).toBeUndefined();
  });
});

describe('defineRule — gate: gatePlaceholder only', () => {
  it('produces a validate function', () => {
    const rule = defineRule(
      spec({ id: 'g2', mask: { kind: 'prefix' }, gatePlaceholder: true }),
    );
    expect(rule.validate).toBeDefined();
  });

  it('returns false for a placeholder value', () => {
    const rule = defineRule(
      spec({ id: 'g3', mask: { kind: 'prefix' }, gatePlaceholder: true }),
    );
    const phMatch: RuleMatch = { value: 'your-key-here', start: 0, end: 13 };
    expect(rule.validate!(phMatch, CLEAN_CTX)).toBe(false);
  });

  it('returns true for a clean value in a clean file', () => {
    const rule = defineRule(
      spec({ id: 'g4', mask: { kind: 'prefix' }, gatePlaceholder: true }),
    );
    expect(rule.validate!(CLEAN_MATCH, CLEAN_CTX)).toBe(true);
  });

  it('returns true even for an example path (path gate is OFF)', () => {
    const rule = defineRule(
      spec({ id: 'g5', mask: { kind: 'prefix' }, gatePlaceholder: true }),
    );
    // example path should NOT be filtered — only gatePlaceholder is on
    expect(rule.validate!(CLEAN_MATCH, EXAMPLE_CTX)).toBe(true);
  });
});

describe('defineRule — gate: gateExamplePath only', () => {
  it('produces a validate function', () => {
    const rule = defineRule(
      spec({ id: 'g6', mask: { kind: 'prefix' }, gateExamplePath: true }),
    );
    expect(rule.validate).toBeDefined();
  });

  it('returns false for an example-path context', () => {
    const rule = defineRule(
      spec({ id: 'g7', mask: { kind: 'prefix' }, gateExamplePath: true }),
    );
    expect(rule.validate!(CLEAN_MATCH, EXAMPLE_CTX)).toBe(false);
  });

  it('returns true for a real-path context (even with a placeholder value — gate is OFF)', () => {
    const rule = defineRule(
      spec({ id: 'g8', mask: { kind: 'prefix' }, gateExamplePath: true }),
    );
    // placeholder value is NOT filtered because gatePlaceholder is off
    const phMatch: RuleMatch = { value: 'your-key-here', start: 0, end: 13 };
    expect(rule.validate!(phMatch, CLEAN_CTX)).toBe(true);
  });
});

describe('defineRule — gate: both gatePlaceholder AND gateExamplePath', () => {
  it('produces a validate function', () => {
    const rule = defineRule(
      spec({ id: 'g9', mask: { kind: 'prefix' }, gatePlaceholder: true, gateExamplePath: true }),
    );
    expect(rule.validate).toBeDefined();
  });

  it('returns false for a placeholder value (first short-circuit)', () => {
    const rule = defineRule(
      spec({ id: 'g10', mask: { kind: 'prefix' }, gatePlaceholder: true, gateExamplePath: true }),
    );
    const phMatch: RuleMatch = { value: 'xxxxxxxxxxxxxxxxxxxx', start: 0, end: 20 };
    expect(rule.validate!(phMatch, CLEAN_CTX)).toBe(false);
  });

  it('returns false for an example path when value is clean (second check)', () => {
    const rule = defineRule(
      spec({ id: 'g11', mask: { kind: 'prefix' }, gatePlaceholder: true, gateExamplePath: true }),
    );
    // Non-placeholder value → passes gatePlaceholder, but example path → false
    expect(rule.validate!(CLEAN_MATCH, EXAMPLE_CTX)).toBe(false);
  });

  it('returns true when value is clean AND path is not an example', () => {
    const rule = defineRule(
      spec({ id: 'g12', mask: { kind: 'prefix' }, gatePlaceholder: true, gateExamplePath: true }),
    );
    expect(rule.validate!(CLEAN_MATCH, CLEAN_CTX)).toBe(true);
  });
});

// ─── scalar fields are copied through ─────────────────────────────────────────

describe('defineRule — scalar field pass-through', () => {
  it('copies id, name, severity, pattern, keywords, message', () => {
    const s = spec({
      id: 'pt1',
      name: 'My Rule',
      severity: 'critical',
      pattern: /pat-[a-z]{4}/g,
      keywords: ['pat-'],
      mask: { kind: 'prefix' },
      message: 'My message',
    });
    const rule = defineRule(s);
    expect(rule.id).toBe('pt1');
    expect(rule.name).toBe('My Rule');
    expect(rule.severity).toBe('critical');
    expect(rule.pattern).toBe(s.pattern);
    expect(rule.keywords).toBe(s.keywords);
    expect(rule.message).toBe('My message');
  });
});
