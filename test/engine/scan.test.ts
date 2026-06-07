import { describe, expect, it } from 'vitest';
import { DEFAULT_RULESET, IGNORE_MARKER, scanText } from '../../src/engine';
import { awsAccessKeyRule } from '../../src/engine/rules/aws';

const FILE = 'src/app.ts';
const scan = (text: string, filename = FILE) => scanText(text, { filename });

const AWS = 'AKIAIOSFODNN7QWERTYZ';
const GH = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

describe('scanText mechanics', () => {
  it('returns an empty array for clean text', () => {
    expect(scan('just some words')).toEqual([]);
  });

  it('reports precise line and column offsets', () => {
    const f = scan(`line zero\nconst x = 1\nconst k = "${AWS}"`);
    expect(f).toHaveLength(1);
    expect(f[0].line).toBe(2);
    expect(f[0].column).toBe(11);
  });

  it('sorts findings by position across many lines', () => {
    const doc = [`const a = "${AWS}"`, 'plain text', 'more text', `const z = "${GH}"`].join('\n');
    const f = scan(doc);
    expect(f.map((x) => x.line)).toEqual([0, 3]);
    expect(f[0].start).toBeLessThan(f[1].start);
  });

  it('attaches entropy only to entropy-gated findings', () => {
    const gated = scan('const secret = "aZ9kP3xR7mQ2wL5tN8vBcD"')[0];
    const plain = scan(`const k = "${AWS}"`)[0];
    expect(gated.entropy).toBeDefined();
    expect(plain.entropy).toBeUndefined();
  });

  it('keeps the most severe finding when spans overlap at the same start', () => {
    // The quoted value begins with an AWS key, so both the AWS rule (critical) and the
    // generic high-entropy rule (medium) match at the same offset; AWS must win.
    const f = scan(`api_key = "${AWS}-tail"`);
    expect(f).toHaveLength(1);
    expect(f[0].ruleId).toBe('aws-access-key-id');
  });

  it('collapses two equal-severity overlaps into one', () => {
    // Both the generic and the env-leak rule match this assignment at the same span.
    const f = scan('SECRET_TOKEN = "aZ9kP3xR7mQ2wL5t"');
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('medium');
  });

  it('honours an inline ignore marker on the finding line', () => {
    expect(scan(`const k = "${AWS}" // ${IGNORE_MARKER}\nconst y = 1`)).toHaveLength(0);
  });

  it('keeps findings when the ignore marker is on a different line', () => {
    expect(scan(`const k = "${AWS}"\n// ${IGNORE_MARKER} note`)).toHaveLength(1);
  });

  it('honours an ignore marker on the last line (no trailing newline)', () => {
    expect(scan(`x = 1\nconst k = "${AWS}" // ${IGNORE_MARKER}`)).toHaveLength(0);
  });

  it('gives identical secret values the same fingerprint (cross-line clustering)', () => {
    const f = scan(`const a = "${AWS}"\nconst b = "${AWS}"`);
    expect(f).toHaveLength(2);
    expect(f[0].fingerprint).toBe(f[1].fingerprint);
  });

  it('gives different secret values different fingerprints', () => {
    const f = scan(`const a = "${AWS}"\nconst z = "${GH}"`);
    expect(f[0].fingerprint).not.toBe(f[1].fingerprint);
  });

  it('uses the default ruleset when none is provided', () => {
    expect(DEFAULT_RULESET.rules.length).toBeGreaterThan(0);
  });

  it('accepts a custom ruleset', () => {
    const f = scanText(AWS, { filename: FILE, ruleset: { rules: [awsAccessKeyRule] } });
    expect(f).toHaveLength(1);
    expect(f[0].ruleId).toBe('aws-access-key-id');
  });
});
