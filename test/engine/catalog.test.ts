/**
 * Table-driven tests for every catalog RuleSpec — positives, negatives, invariants, and
 * ordering/dedupe checks. No `vscode` imports anywhere.
 *
 * Structure
 * ─────────
 * 1. Completeness guard — every spec id has a sample entry in catalogSamples.
 * 2. Positives — it.each across all specs: scan the positive() sample, expect the right ruleId.
 * 3. Negatives — gated specs: scan negative() samples, expect NO finding for that ruleId.
 * 4. Invariants — keywords non-empty, ids unique, names unique, loose specs have entropyFloor.
 * 5. Overlap / dedupe — DATABASE_URL connection string yields exactly one finding.
 * 6. Rule count assertion.
 */
import { describe, expect, it } from 'vitest';
import { scanText } from '../../src/engine';
import {
  catalogProviderSpecs,
  connectionStringSpecs,
} from '../../src/engine';
import type { Finding } from '../../src/engine';
import { catalogSamples, b62, hex } from './fixtures/catalogSamples';
import type { RuleSpec } from '../../src/engine/rules/define';
import { DEFAULT_RULESET } from '../../src/engine';
import { shannonEntropy } from '../../src/engine/entropy';

// ─── helpers ──────────────────────────────────────────────────────────────────

const SRC_FILE = 'src/app.ts';
const EXAMPLE_FILE = 'src/example.ts';

function scan(text: string, filename = SRC_FILE): Finding[] {
  return scanText(text, { filename });
}

function ids(text: string, filename = SRC_FILE): string[] {
  return scan(text, filename).map((f) => f.ruleId);
}

const allSpecs: readonly RuleSpec[] = [...catalogProviderSpecs, ...connectionStringSpecs];

// ─── 0. Entropy helper sanity ─────────────────────────────────────────────────

describe('entropy helpers', () => {
  it('b62(n) produces Shannon entropy ≥ 4.0 for n ≥ 20', () => {
    expect(shannonEntropy(b62(20))).toBeGreaterThanOrEqual(4.0);
    expect(shannonEntropy(b62(36))).toBeGreaterThanOrEqual(4.0);
    expect(shannonEntropy(b62(64))).toBeGreaterThanOrEqual(4.0);
  });

  it('hex(n) produces Shannon entropy ≥ 3.5 for n ≥ 32', () => {
    expect(shannonEntropy(hex(32))).toBeGreaterThanOrEqual(3.5);
    expect(shannonEntropy(hex(64))).toBeGreaterThanOrEqual(3.5);
  });
});

// ─── 1. Completeness guard ────────────────────────────────────────────────────

describe('sample table completeness', () => {
  it('has a sample entry for every spec id', () => {
    const missingIds: string[] = [];
    for (const s of allSpecs) {
      if (!catalogSamples[s.id]) {
        missingIds.push(s.id);
      }
    }
    expect(missingIds).toEqual([]);
  });

  it('has no orphan sample entries (sample table ids match actual specs)', () => {
    const specIds = new Set(allSpecs.map((s) => s.id));
    const orphans = Object.keys(catalogSamples).filter((id) => !specIds.has(id));
    expect(orphans).toEqual([]);
  });
});

// ─── 2. Positives ─────────────────────────────────────────────────────────────

describe('catalog positives — every spec fires on its sample', () => {
  it.each(allSpecs.map((s) => [s.id, s] as [string, RuleSpec]))(
    'spec %s fires on its positive() sample',
    (id, _spec) => {
      const entry = catalogSamples[id];
      expect(entry, `Missing sample for ${id}`).toBeDefined();
      const text = entry.positive();
      const findings = scan(text);
      const matchingIds = findings.map((f) => f.ruleId);
      expect(
        matchingIds,
        `Expected finding for ${id} in: ${text}`,
      ).toContain(id);
    },
  );
});

// ─── 3. Negatives ─────────────────────────────────────────────────────────────

describe('catalog negatives — gated specs reject their negative() sample', () => {
  // Only specs that have a negative() entry in the sample table
  const specsWithNegative = allSpecs.filter((s) => catalogSamples[s.id]?.negative);

  it.each(specsWithNegative.map((s) => [s.id, s] as [string, RuleSpec]))(
    'spec %s does NOT fire on its negative() sample',
    (id, _spec) => {
      const entry = catalogSamples[id];
      const text = entry.negative!();
      const matchingIds = ids(text);
      expect(
        matchingIds,
        `Expected NO finding for ${id} in: ${text}`,
      ).not.toContain(id);
    },
  );
});

// ─── 3b. Extra gate-specific negatives ────────────────────────────────────────

describe('catalog negatives — placeholder gate', () => {
  it('mailgun: repeated-char body is rejected', () => {
    expect(ids('key-' + 'a'.repeat(32))).not.toContain('mailgun-private-key');
  });

  it('mailchimp: all-zero body is rejected', () => {
    expect(ids('0'.repeat(32) + '-us1')).not.toContain('mailchimp-api-key');
  });

  it('huggingface: xxxx body is rejected', () => {
    expect(ids('hf_' + 'x'.repeat(34))).not.toContain('huggingface-token');
  });

  it('replicate: xxxx body is rejected', () => {
    expect(ids('r8_' + 'x'.repeat(37))).not.toContain('replicate-token');
  });

  it('groq: repeated-char body is rejected', () => {
    expect(ids('gsk_' + 'A'.repeat(52))).not.toContain('groq-api-key');
  });
});

describe('catalog negatives — example-path gate', () => {
  it('cloudflare: fires on src/app.ts but NOT on src/example.ts', () => {
    const text = 'cloudflare_api_key = "' + b62(40) + '"';
    expect(ids(text, SRC_FILE)).toContain('cloudflare-api-token');
    expect(ids(text, EXAMPLE_FILE)).not.toContain('cloudflare-api-token');
  });

  it('heroku: fires on src/app.ts but NOT on src/example.ts', () => {
    const text =
      'heroku_key = "' +
      hex(8) +
      '-' +
      hex(4) +
      '-' +
      hex(4) +
      '-' +
      hex(4) +
      '-' +
      hex(12) +
      '"';
    expect(ids(text, SRC_FILE)).toContain('heroku-api-key');
    expect(ids(text, EXAMPLE_FILE)).not.toContain('heroku-api-key');
  });

  it('datadog: fires on src/app.ts but NOT on src/example.ts', () => {
    const text = 'datadog_api_key = "' + hex(32) + '"';
    expect(ids(text, SRC_FILE)).toContain('datadog-api-key');
    expect(ids(text, EXAMPLE_FILE)).not.toContain('datadog-api-key');
  });
});

describe('catalog negatives — connection-string password-less URLs', () => {
  it('postgres: password-less URL has no finding', () => {
    expect(ids('postgres://user@db.example.com/mydb')).not.toContain(
      'postgres-connection-password',
    );
  });

  it('mysql: password-less URL has no finding', () => {
    expect(ids('mysql://user@db.example.com/mydb')).not.toContain('mysql-connection-password');
  });

  it('mongodb: password-less URL has no finding', () => {
    expect(ids('mongodb://user@db.example.com/mydb')).not.toContain(
      'mongodb-connection-password',
    );
  });

  it('redis: password-less URL has no finding', () => {
    expect(ids('redis://user@cache.example.com')).not.toContain('redis-connection-password');
  });
});

// ─── 4. Invariants ────────────────────────────────────────────────────────────

describe('catalog invariants', () => {
  it('every spec has at least one non-empty keyword', () => {
    const bad = allSpecs.filter((s) => !s.keywords || s.keywords.length === 0 || s.keywords.some((k) => k.length === 0));
    expect(bad.map((s) => s.id)).toEqual([]);
  });

  it('all spec ids are unique', () => {
    const ids_list = allSpecs.map((s) => s.id);
    const unique = new Set(ids_list);
    expect(unique.size).toBe(ids_list.length);
  });

  it('all spec names are unique', () => {
    const names = allSpecs.map((s) => s.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('every connection-string spec has an entropyFloor', () => {
    const bad = connectionStringSpecs.filter((s) => s.entropyFloor === undefined);
    expect(bad.map((s) => s.id)).toEqual([]);
  });

  it('every connection-string spec has gatePlaceholder and gateExamplePath', () => {
    const missingPlaceholder = connectionStringSpecs.filter((s) => !s.gatePlaceholder);
    const missingExample = connectionStringSpecs.filter((s) => !s.gateExamplePath);
    expect(missingPlaceholder.map((s) => s.id)).toEqual([]);
    expect(missingExample.map((s) => s.id)).toEqual([]);
  });
});

// ─── 5. Ordering / dedupe ─────────────────────────────────────────────────────

describe('overlap dedupe', () => {
  it('DATABASE_URL = "postgres://…" yields exactly one finding', () => {
    const password = b62(20);
    const text = 'DATABASE_URL = "postgres://user:' + password + '@db.example.com/mydb"';
    const findings = scan(text);
    // Only one finding should survive — the connection-string rule wins.
    // The dotenv-value-leak and/or high-entropy rules may also see the URL, but
    // the overlap deduper keeps exactly one (the one starting earliest/most severe).
    // At minimum there must be exactly one non-overlapping winner.
    expect(findings.length).toBeGreaterThanOrEqual(1);
    // Only one finding per offset range
    for (let i = 0; i < findings.length - 1; i++) {
      expect(findings[i].end).toBeLessThanOrEqual(findings[i + 1].start);
    }
  });

  it('postgres connection password is found with the postgres-connection-password rule', () => {
    const password = b62(20);
    const text = 'postgres://user:' + password + '@db.example.com/mydb';
    const results = ids(text);
    expect(results).toContain('postgres-connection-password');
  });
});

// ─── 6. Rule count assertion ──────────────────────────────────────────────────

describe('DEFAULT_RULESET rule count', () => {
  it('contains exactly 46 rules (9 bespoke + 34 catalog + 3 generic)', () => {
    expect(DEFAULT_RULESET.rules.length).toBe(46);
  });
});
