/**
 * Unit tests for `src/cli/core.ts`.
 *
 * Strategy: approach (a) — import the exported pure-ish functions directly under Vitest.
 * File-system operations (collectFiles / scanFiles / buildIgnore / walk) are exercised
 * against real temp directories, giving hermetic but realistic coverage without spawning
 * a subprocess.  No `vscode` imports anywhere.
 *
 * The `mainCore` / `runScanCore` wrappers are tested so that every code path in core.ts
 * is reachable without hitting `process.exit`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ignore from 'ignore';
import {
  EXIT_CLEAN,
  EXIT_FINDINGS,
  EXIT_USAGE,
  USAGE,
  type Format,
  type LocatedFinding,
  buildIgnore,
  collectFiles,
  compareLocated,
  isCounted,
  isIgnored,
  mainCore,
  parseScanArgs,
  renderJson,
  renderSarif,
  renderTextLines,
  rootForTarget,
  runScanCore,
  sarifLevel,
  scanFiles,
  scanStdinContent,
  toJsonFinding,
  toRelPosix,
  walk,
} from '../../src/cli/core';
import type { WalkedFile } from '../../src/cli/core';

// ---------------------------------------------------------------------------
// Shared temp fixture helpers
// ---------------------------------------------------------------------------

/** Known AWS Access Key ID — used as the canonical "secret" in fixtures. */
const AWS_KEY = 'AKIAIOSFODNN7QWERTYZ';

/** Known GitHub token — 40+ chars after prefix. */
const GH_TOKEN = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** A source file that contains a known secret. */
const SECRET_SOURCE = `const apiKey = "${AWS_KEY}";\n`;

/** A clean source file with no secrets. */
const CLEAN_SOURCE = `export function add(a: number, b: number): number {\n  return a + b;\n}\n`;

// ---------------------------------------------------------------------------
// Temp directory management
// ---------------------------------------------------------------------------

let tmpRoot: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'leakerlens-cli-test-'));
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** Create an isolated sub-directory inside tmpRoot for each test group. */
function makeFixtureDir(name: string): string {
  const dir = join(tmpRoot, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// parseScanArgs
// ---------------------------------------------------------------------------

describe('parseScanArgs', () => {
  it('returns defaults for an empty argv', () => {
    const args = parseScanArgs([]);
    expect(args.paths).toEqual([]);
    expect(args.format).toBe('text');
    expect(args.stdin).toBe(false);
    expect(args.stdinFilename).toBeUndefined();
  });

  it('parses --json', () => {
    expect(parseScanArgs(['--json']).format).toBe('json');
  });

  it('parses --sarif', () => {
    expect(parseScanArgs(['--sarif']).format).toBe('sarif');
  });

  it('allows --json repeated (idempotent)', () => {
    expect(parseScanArgs(['--json', '--json']).format).toBe('json');
  });

  it('allows --sarif repeated (idempotent)', () => {
    expect(parseScanArgs(['--sarif', '--sarif']).format).toBe('sarif');
  });

  it('throws when --json and --sarif are both specified', () => {
    expect(() => parseScanArgs(['--json', '--sarif'])).toThrow('mutually exclusive');
    expect(() => parseScanArgs(['--sarif', '--json'])).toThrow('mutually exclusive');
  });

  it('parses --stdin --filename together', () => {
    const args = parseScanArgs(['--stdin', '--filename', 'foo.ts']);
    expect(args.stdin).toBe(true);
    expect(args.stdinFilename).toBe('foo.ts');
  });

  it('throws when --stdin is given without --filename', () => {
    expect(() => parseScanArgs(['--stdin'])).toThrow('--stdin requires --filename');
  });

  it('throws when --filename is given without --stdin', () => {
    expect(() => parseScanArgs(['--filename', 'foo.ts'])).toThrow(
      '--filename is only valid with --stdin',
    );
  });

  it('throws when --filename value is missing (end of argv)', () => {
    expect(() => parseScanArgs(['--stdin', '--filename'])).toThrow('--filename requires a value');
  });

  it('throws when --filename value looks like another flag', () => {
    expect(() => parseScanArgs(['--stdin', '--filename', '--json'])).toThrow(
      '--filename requires a value',
    );
  });

  it('throws on unknown flags', () => {
    expect(() => parseScanArgs(['--unknown-flag'])).toThrow('unknown option: --unknown-flag');
  });

  it('collects positional paths', () => {
    const args = parseScanArgs(['src/', 'lib/']);
    expect(args.paths).toEqual(['src/', 'lib/']);
  });

  it('separates flags from paths correctly', () => {
    const args = parseScanArgs(['src/', '--json', 'lib/']);
    expect(args.paths).toEqual(['src/', 'lib/']);
    expect(args.format).toBe('json');
  });
});

// ---------------------------------------------------------------------------
// sarifLevel
// ---------------------------------------------------------------------------

describe('sarifLevel', () => {
  it('maps critical → error', () => {
    expect(sarifLevel('critical')).toBe('error');
  });

  it('maps high → error', () => {
    expect(sarifLevel('high')).toBe('error');
  });

  it('maps medium → warning', () => {
    expect(sarifLevel('medium')).toBe('warning');
  });

  it('maps low → note', () => {
    expect(sarifLevel('low')).toBe('note');
  });
});

// ---------------------------------------------------------------------------
// scanStdinContent
// ---------------------------------------------------------------------------

describe('scanStdinContent', () => {
  it('returns findings attributed to the given filename', () => {
    const results = scanStdinContent(SECRET_SOURCE, 'app.ts');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file).toBe('app.ts');
  });

  it('normalises backslash separators in the filename', () => {
    const results = scanStdinContent(SECRET_SOURCE, 'src\\app.ts');
    expect(results[0].file).toBe('src/app.ts');
  });

  it('returns empty for clean content', () => {
    expect(scanStdinContent(CLEAN_SOURCE, 'util.ts')).toEqual([]);
  });

  it('finding has correct 0-based line (toJsonFinding will add 1)', () => {
    // The secret is on line 0 (the first line of SECRET_SOURCE)
    const results = scanStdinContent(SECRET_SOURCE, 'app.ts');
    expect(results[0].finding.line).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// toJsonFinding
// ---------------------------------------------------------------------------

describe('toJsonFinding', () => {
  it('produces 1-based line and column', () => {
    const [lf] = scanStdinContent(SECRET_SOURCE, 'app.ts');
    const jf = toJsonFinding(lf);
    // engine returns 0-based; toJsonFinding must add 1
    expect(jf.line).toBe(lf.finding.line + 1);
    expect(jf.column).toBe(lf.finding.column + 1);
  });

  it('carries file, ruleId, ruleName, severity, matchPreview, fingerprint, message', () => {
    const [lf] = scanStdinContent(SECRET_SOURCE, 'app.ts');
    const jf = toJsonFinding(lf);
    expect(jf.file).toBe('app.ts');
    expect(jf.ruleId).toBe('aws-access-key-id');
    expect(typeof jf.ruleName).toBe('string');
    expect(['critical', 'high', 'medium', 'low']).toContain(jf.severity);
    expect(typeof jf.matchPreview).toBe('string');
    expect(typeof jf.fingerprint).toBe('string');
    expect(typeof jf.message).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// renderJson
// ---------------------------------------------------------------------------

describe('renderJson', () => {
  it('returns valid JSON ending with a newline', () => {
    const located = scanStdinContent(SECRET_SOURCE, 'app.ts');
    const output = renderJson(located);
    expect(() => JSON.parse(output)).not.toThrow();
    expect(output.endsWith('\n')).toBe(true);
  });

  it('has the correct shape: { findings[], summary: { total, bySeverity } }', () => {
    const located = scanStdinContent(SECRET_SOURCE, 'app.ts');
    const parsed = JSON.parse(renderJson(located)) as {
      findings: unknown[];
      summary: { total: number; bySeverity: Record<string, number> };
    };
    expect(Array.isArray(parsed.findings)).toBe(true);
    expect(typeof parsed.summary.total).toBe('number');
    expect(parsed.summary.total).toBe(parsed.findings.length);
    expect(typeof parsed.summary.bySeverity).toBe('object');
    expect('critical' in parsed.summary.bySeverity).toBe(true);
  });

  it('emits 1-based line/column in findings', () => {
    const located = scanStdinContent(SECRET_SOURCE, 'app.ts');
    const parsed = JSON.parse(renderJson(located)) as { findings: { line: number; column: number }[] };
    for (const f of parsed.findings) {
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
    }
  });

  it('returns empty findings array and total=0 for a clean file', () => {
    const parsed = JSON.parse(renderJson([])) as {
      findings: unknown[];
      summary: { total: number };
    };
    expect(parsed.findings).toEqual([]);
    expect(parsed.summary.total).toBe(0);
  });

  it('counts findings by severity correctly', () => {
    const located = scanStdinContent(SECRET_SOURCE, 'app.ts');
    const parsed = JSON.parse(renderJson(located)) as {
      summary: { bySeverity: Record<string, number> };
    };
    // AWS key is critical
    expect(parsed.summary.bySeverity['critical']).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// renderSarif
// ---------------------------------------------------------------------------

describe('renderSarif', () => {
  it('returns valid JSON ending with a newline', () => {
    const located = scanStdinContent(SECRET_SOURCE, 'app.ts');
    const output = renderSarif(located);
    expect(() => JSON.parse(output)).not.toThrow();
    expect(output.endsWith('\n')).toBe(true);
  });

  it('has SARIF 2.1.0 top-level schema and version', () => {
    const parsed = JSON.parse(renderSarif(scanStdinContent(SECRET_SOURCE, 'app.ts'))) as {
      $schema: string;
      version: string;
    };
    expect(parsed.version).toBe('2.1.0');
    expect(parsed.$schema).toContain('sarif-schema-2.1.0');
  });

  it('has exactly one run with tool.driver.name = "LeakerLens"', () => {
    const parsed = JSON.parse(renderSarif(scanStdinContent(SECRET_SOURCE, 'app.ts'))) as {
      runs: { tool: { driver: { name: string } } }[];
    };
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0].tool.driver.name).toBe('LeakerLens');
  });

  it('populates tool.driver.rules[] with the seen ruleIds', () => {
    const parsed = JSON.parse(renderSarif(scanStdinContent(SECRET_SOURCE, 'app.ts'))) as {
      runs: { tool: { driver: { rules: { id: string }[] } } }[];
    };
    const ruleIds = parsed.runs[0].tool.driver.rules.map((r) => r.id);
    expect(ruleIds).toContain('aws-access-key-id');
  });

  it('has result with level, message, and physicalLocation.region (1-based)', () => {
    type SarifResult = {
      ruleId: string;
      level: string;
      message: { text: string };
      locations: { physicalLocation: { region: { startLine: number; startColumn: number } } }[];
    };
    const parsed = JSON.parse(renderSarif(scanStdinContent(SECRET_SOURCE, 'app.ts'))) as {
      runs: { results: SarifResult[] }[];
    };
    const result = parsed.runs[0].results[0];
    expect(result.ruleId).toBe('aws-access-key-id');
    expect(result.level).toBe('error'); // critical → error
    expect(typeof result.message.text).toBe('string');
    const region = result.locations[0].physicalLocation.region;
    expect(region.startLine).toBeGreaterThanOrEqual(1);
    expect(region.startColumn).toBeGreaterThanOrEqual(1);
  });

  it('deduplicates rules when the same ruleId appears multiple times', () => {
    // Two findings with the same ruleId
    const twoAwsLines = `const a = "${AWS_KEY}";\nconst b = "${AWS_KEY}";\n`;
    const located = scanStdinContent(twoAwsLines, 'app.ts');
    expect(located.length).toBeGreaterThanOrEqual(2);
    const parsed = JSON.parse(renderSarif(located)) as {
      runs: { tool: { driver: { rules: unknown[] } }; results: unknown[] }[];
    };
    // rules should have exactly one entry for aws-access-key-id
    expect(parsed.runs[0].tool.driver.rules).toHaveLength(1);
    // but results should have two entries
    expect(parsed.runs[0].results).toHaveLength(located.length);
  });

  it('returns empty runs.results for clean input', () => {
    const parsed = JSON.parse(renderSarif([])) as { runs: { results: unknown[] }[] };
    expect(parsed.runs[0].results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// renderTextLines
// ---------------------------------------------------------------------------

describe('renderTextLines', () => {
  it('returns null for empty findings', () => {
    expect(renderTextLines([])).toBeNull();
  });

  it('includes severity, rule name, file, line, column, and preview per finding', () => {
    const located = scanStdinContent(SECRET_SOURCE, 'src/app.ts');
    const output = renderTextLines(located);
    expect(output).not.toBeNull();
    expect(output).toContain('CRITICAL');
    expect(output).toContain('src/app.ts');
    expect(output).toContain('AWS Access Key ID');
  });

  it('ends with a summary line containing the count', () => {
    const located = scanStdinContent(SECRET_SOURCE, 'app.ts');
    const output = renderTextLines(located) as string;
    expect(output).toContain('potential secret(s) found');
    expect(output).toContain(`${located.length}`);
  });
});

// ---------------------------------------------------------------------------
// compareLocated
// ---------------------------------------------------------------------------

describe('compareLocated', () => {
  /** Build a minimal LocatedFinding with only the fields compareLocated needs. */
  function lf(file: string, start: number, ruleId = 'r'): LocatedFinding {
    return {
      file,
      finding: {
        ruleId,
        ruleName: 'R',
        severity: 'low',
        start,
        end: start + 1,
        line: 0,
        column: start,
        matchPreview: 'x',
        fingerprint: 'fp',
        message: 'm',
        remediations: [],
      },
    };
  }

  it('sorts by file path first', () => {
    expect(compareLocated(lf('a.ts', 0), lf('b.ts', 0))).toBeLessThan(0);
    expect(compareLocated(lf('b.ts', 0), lf('a.ts', 0))).toBeGreaterThan(0);
  });

  it('sorts by start offset when files are equal', () => {
    expect(compareLocated(lf('a.ts', 5), lf('a.ts', 10))).toBeLessThan(0);
  });

  it('sorts by ruleId as final tiebreaker', () => {
    expect(compareLocated(lf('a.ts', 5, 'a'), lf('a.ts', 5, 'b'))).toBeLessThan(0);
    expect(compareLocated(lf('a.ts', 5, 'b'), lf('a.ts', 5, 'a'))).toBeGreaterThan(0);
  });

  it('returns 0 for identical entries', () => {
    expect(compareLocated(lf('a.ts', 5, 'r'), lf('a.ts', 5, 'r'))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isIgnored / buildIgnore / toRelPosix / rootForTarget
// ---------------------------------------------------------------------------

describe('isIgnored', () => {
  it('returns false for the empty string (root)', () => {
    const ig = ignore();
    ig.add('*.log');
    expect(isIgnored(ig, '')).toBe(false);
  });

  it('returns false for paths starting with ..', () => {
    const ig = ignore();
    ig.add('**/*');
    expect(isIgnored(ig, '../outside/file.ts')).toBe(false);
  });

  it('returns true for a path matched by the ignore rules', () => {
    const ig = ignore();
    ig.add('*.log');
    expect(isIgnored(ig, 'debug.log')).toBe(true);
  });

  it('returns false for a path not matched', () => {
    const ig = ignore();
    ig.add('*.log');
    expect(isIgnored(ig, 'src/index.ts')).toBe(false);
  });
});

describe('buildIgnore', () => {
  it('includes EXCLUDED_DIRS in the matcher', () => {
    const root = makeFixtureDir('build-ignore-1');
    const ig = buildIgnore(root);
    // node_modules/ is in EXCLUDED_DIRS
    expect(ig.ignores('node_modules/foo')).toBe(true);
    expect(ig.ignores('dist/bundle.js')).toBe(true);
  });

  it('reads a .gitignore from root when present', () => {
    const root = makeFixtureDir('build-ignore-2');
    writeFileSync(join(root, '.gitignore'), '*.log\n');
    const ig = buildIgnore(root);
    expect(ig.ignores('app.log')).toBe(true);
    expect(ig.ignores('src/index.ts')).toBe(false);
  });

  it('works without a .gitignore (no throw)', () => {
    const root = makeFixtureDir('build-ignore-3');
    // No .gitignore — should not throw
    expect(() => buildIgnore(root)).not.toThrow();
  });
});

describe('toRelPosix', () => {
  it('converts backslash separators to forward slashes', () => {
    // Construct a path that uses sep so this is meaningful on Windows
    const root = 'C:\\project';
    const abs = 'C:\\project\\src\\app.ts';
    const result = toRelPosix(root, abs);
    expect(result).not.toContain('\\');
  });
});

describe('rootForTarget', () => {
  it('returns cwd when target is inside cwd', () => {
    const root = makeFixtureDir('root-for-target-1');
    const sub = join(root, 'src', 'app.ts');
    expect(rootForTarget(root, sub)).toBe(root);
  });

  it('returns the target dir itself when target is a directory outside cwd', () => {
    const cwd = makeFixtureDir('root-for-target-cwd');
    const external = makeFixtureDir('root-for-target-external');
    expect(rootForTarget(cwd, external)).toBe(external);
  });

  it("returns the parent dir when target is a file outside cwd (dir doesn't exist)", () => {
    const cwd = makeFixtureDir('root-for-target-cwd2');
    // A path on a completely different (non-existent) location
    const externalFile = join(tmpRoot, 'nonexistent-dir', 'secret.ts');
    const result = rootForTarget(cwd, externalFile);
    // dirname of externalFile
    expect(result).toBe(join(tmpRoot, 'nonexistent-dir'));
  });
});

// ---------------------------------------------------------------------------
// walk
// ---------------------------------------------------------------------------

describe('walk', () => {
  it('collects files recursively', () => {
    const root = makeFixtureDir('walk-1');
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'app.ts'), CLEAN_SOURCE);
    writeFileSync(join(root, 'README.md'), '# readme');

    const ig = buildIgnore(root);
    const into: WalkedFile[] = [];
    walk(root, ig, root, into);

    const files = into.map((f) => f.relPosix);
    expect(files).toContain('src/app.ts');
    expect(files).toContain('README.md');
  });

  it('skips node_modules', () => {
    const root = makeFixtureDir('walk-2');
    mkdirSync(join(root, 'node_modules', 'lib'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'lib', 'index.js'), 'module.exports = {}');
    writeFileSync(join(root, 'index.ts'), CLEAN_SOURCE);

    const ig = buildIgnore(root);
    const into: WalkedFile[] = [];
    walk(root, ig, root, into);

    const files = into.map((f) => f.relPosix);
    expect(files).toContain('index.ts');
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
  });

  it('skips gitignored files', () => {
    const root = makeFixtureDir('walk-3');
    writeFileSync(join(root, '.gitignore'), '*.log\n');
    writeFileSync(join(root, 'app.log'), 'log data');
    writeFileSync(join(root, 'app.ts'), CLEAN_SOURCE);

    const ig = buildIgnore(root);
    const into: WalkedFile[] = [];
    walk(root, ig, root, into);

    const files = into.map((f) => f.relPosix);
    expect(files).toContain('app.ts');
    expect(files).not.toContain('app.log');
  });

  it('handles a non-existent path gracefully (no throw)', () => {
    const root = makeFixtureDir('walk-4');
    const ig = buildIgnore(root);
    const into: WalkedFile[] = [];
    expect(() => walk(root, ig, join(root, 'nonexistent'), into)).not.toThrow();
    expect(into).toHaveLength(0);
  });

  it('skips an individual gitignored file (not just dirs)', () => {
    const root = makeFixtureDir('walk-5');
    writeFileSync(join(root, '.gitignore'), 'secret.env\n');
    writeFileSync(join(root, 'secret.env'), `DB_PASS=${AWS_KEY}`);
    writeFileSync(join(root, 'safe.ts'), CLEAN_SOURCE);

    const ig = buildIgnore(root);
    const into: WalkedFile[] = [];
    walk(root, ig, root, into);

    const files = into.map((f) => f.relPosix);
    expect(files).toContain('safe.ts');
    expect(files).not.toContain('secret.env');
  });
});

// ---------------------------------------------------------------------------
// isCounted
// ---------------------------------------------------------------------------

describe('isCounted', () => {
  it('returns true for non-.env files regardless of gitignore', () => {
    const ig = ignore();
    ig.add('src/app.ts');
    const f: WalkedFile = { abs: '/proj/src/app.ts', relPosix: 'src/app.ts' };
    expect(isCounted(ig, f)).toBe(true);
  });

  it('returns true for a non-gitignored .env', () => {
    const ig = ignore();
    // .env is NOT in the ignore list
    const f: WalkedFile = { abs: '/proj/.env', relPosix: '.env' };
    expect(isCounted(ig, f)).toBe(true);
  });

  it('returns false for a gitignored .env (env-file policy)', () => {
    const ig = ignore();
    ig.add('.env');
    const f: WalkedFile = { abs: '/proj/.env', relPosix: '.env' };
    expect(isCounted(ig, f)).toBe(false);
  });

  it('returns false for a gitignored .env.local', () => {
    const ig = ignore();
    ig.add('.env.local');
    const f: WalkedFile = { abs: '/proj/.env.local', relPosix: '.env.local' };
    expect(isCounted(ig, f)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// collectFiles / scanFiles  — file-system integration
// ---------------------------------------------------------------------------

describe('collectFiles', () => {
  it('defaults to cwd (.) when no paths given', () => {
    const root = makeFixtureDir('collect-1');
    writeFileSync(join(root, 'a.ts'), CLEAN_SOURCE);
    const groups = collectFiles(root, []);
    const files = groups.flatMap((g) => g.files);
    expect(files.map((f) => f.relPosix)).toContain('a.ts');
  });

  it('deduplicates files when the same absolute path is given twice', () => {
    const root = makeFixtureDir('collect-2');
    writeFileSync(join(root, 'a.ts'), CLEAN_SOURCE);
    const groups = collectFiles(root, ['a.ts', 'a.ts']);
    const files = groups.flatMap((g) => g.files);
    const matching = files.filter((f) => f.relPosix === 'a.ts');
    expect(matching).toHaveLength(1);
  });

  it('handles explicit file path (not just dirs)', () => {
    const root = makeFixtureDir('collect-3');
    writeFileSync(join(root, 'secrets.ts'), SECRET_SOURCE);
    const groups = collectFiles(root, ['secrets.ts']);
    const files = groups.flatMap((g) => g.files);
    expect(files.map((f) => f.relPosix)).toContain('secrets.ts');
  });
});

describe('scanFiles', () => {
  it('returns findings for a file with a known secret', () => {
    const root = makeFixtureDir('scan-files-1');
    writeFileSync(join(root, 'app.ts'), SECRET_SOURCE);
    const results = scanFiles(root, ['app.ts']);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file).toBe('app.ts');
    expect(results[0].finding.ruleId).toBe('aws-access-key-id');
  });

  it('returns empty for a clean file', () => {
    const root = makeFixtureDir('scan-files-2');
    writeFileSync(join(root, 'util.ts'), CLEAN_SOURCE);
    expect(scanFiles(root, ['util.ts'])).toHaveLength(0);
  });

  it('returns deterministic (sorted) results on repeated calls', () => {
    const root = makeFixtureDir('scan-files-3');
    writeFileSync(join(root, 'a.ts'), SECRET_SOURCE);
    writeFileSync(join(root, 'b.ts'), `const t = "${GH_TOKEN}";\n`);
    const r1 = scanFiles(root, []);
    const r2 = scanFiles(root, []);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('skips files inside node_modules', () => {
    const root = makeFixtureDir('scan-files-4');
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.ts'), SECRET_SOURCE);
    writeFileSync(join(root, 'clean.ts'), CLEAN_SOURCE);
    const results = scanFiles(root, []);
    expect(results.every((r) => !r.file.includes('node_modules'))).toBe(true);
  });

  it('skips files inside dist', () => {
    const root = makeFixtureDir('scan-files-dist');
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist', 'bundle.js'), SECRET_SOURCE);
    writeFileSync(join(root, 'clean.ts'), CLEAN_SOURCE);
    const results = scanFiles(root, []);
    expect(results.every((r) => !r.file.startsWith('dist/'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Env-file policy (the subtlest behaviour)
// ---------------------------------------------------------------------------

describe('env-file policy', () => {
  it('.env with a secret and NO .gitignore → counted (exit 1)', () => {
    const root = makeFixtureDir('env-policy-1');
    writeFileSync(join(root, '.env'), `AWS_KEY=${AWS_KEY}\n`);
    const results = scanFiles(root, []);
    // .env is not gitignored → counted
    expect(results.length).toBeGreaterThan(0);
  });

  it('.env with a secret AND .gitignore containing .env → uncounted (exit 0)', () => {
    const root = makeFixtureDir('env-policy-2');
    writeFileSync(join(root, '.env'), `AWS_KEY=${AWS_KEY}\n`);
    writeFileSync(join(root, '.gitignore'), '.env\n');
    const results = scanFiles(root, []);
    // .env IS gitignored → walk skips it entirely (not collected), so no findings
    expect(results).toHaveLength(0);
  });

  it('.env.local with secret and .gitignore containing .env.local → uncounted', () => {
    const root = makeFixtureDir('env-policy-3');
    writeFileSync(join(root, '.env.local'), `SECRET=${AWS_KEY}\n`);
    writeFileSync(join(root, '.gitignore'), '.env.local\n');
    const results = scanFiles(root, []);
    expect(results).toHaveLength(0);
  });

  it('regular source file with a secret is always counted even if gitignored (walk excludes before counting)', () => {
    // Note: if a source file is gitignored, walk won't collect it at all.
    // So this test verifies that non-.env non-gitignored source files are counted.
    const root = makeFixtureDir('env-policy-4');
    writeFileSync(join(root, 'app.ts'), SECRET_SOURCE);
    const results = scanFiles(root, ['app.ts']);
    expect(results.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// runScanCore — the scan command wrapper
// ---------------------------------------------------------------------------

describe('runScanCore', () => {
  it('exit 0 for clean scan', () => {
    const root = makeFixtureDir('run-scan-clean');
    writeFileSync(join(root, 'util.ts'), CLEAN_SOURCE);
    const { exitCode } = runScanCore(['util.ts'], { stdinContent: '', cwd: root });
    expect(exitCode).toBe(EXIT_CLEAN);
  });

  it('exit 1 for scan with findings', () => {
    const root = makeFixtureDir('run-scan-findings');
    writeFileSync(join(root, 'secret.ts'), SECRET_SOURCE);
    const { exitCode } = runScanCore(['secret.ts'], { stdinContent: '', cwd: root });
    expect(exitCode).toBe(EXIT_FINDINGS);
  });

  it('exit 2 for unknown option', () => {
    const root = makeFixtureDir('run-scan-err');
    const { exitCode, stderr } = runScanCore(['--unknown'], { stdinContent: '', cwd: root });
    expect(exitCode).toBe(EXIT_USAGE);
    expect(stderr).toContain('unknown option');
  });

  it('--json output is valid JSON with correct shape', () => {
    const root = makeFixtureDir('run-scan-json');
    writeFileSync(join(root, 'secret.ts'), SECRET_SOURCE);
    const { exitCode, stdout } = runScanCore(['--json', 'secret.ts'], {
      stdinContent: '',
      cwd: root,
    });
    expect(exitCode).toBe(EXIT_FINDINGS);
    const parsed = JSON.parse(stdout) as {
      findings: { file: string; line: number; column: number; fingerprint: string; matchPreview: string }[];
      summary: { total: number };
    };
    expect(parsed.findings.length).toBeGreaterThan(0);
    const f = parsed.findings[0];
    expect(f.file).toBe('secret.ts');
    expect(f.line).toBeGreaterThanOrEqual(1);
    expect(f.column).toBeGreaterThanOrEqual(1);
    expect(typeof f.matchPreview).toBe('string');
    expect(typeof f.fingerprint).toBe('string');
  });

  it('--sarif output is valid SARIF 2.1.0', () => {
    const root = makeFixtureDir('run-scan-sarif');
    writeFileSync(join(root, 'secret.ts'), SECRET_SOURCE);
    const { exitCode, stdout } = runScanCore(['--sarif', 'secret.ts'], {
      stdinContent: '',
      cwd: root,
    });
    expect(exitCode).toBe(EXIT_FINDINGS);
    const parsed = JSON.parse(stdout) as {
      version: string;
      runs: { tool: { driver: { name: string; rules: unknown[] } }; results: unknown[] }[];
    };
    expect(parsed.version).toBe('2.1.0');
    expect(parsed.runs[0].tool.driver.name).toBe('LeakerLens');
    expect(parsed.runs[0].tool.driver.rules.length).toBeGreaterThan(0);
    expect(parsed.runs[0].results.length).toBeGreaterThan(0);
  });

  it('text format: stderr contains finding info, stdout is empty', () => {
    const root = makeFixtureDir('run-scan-text');
    writeFileSync(join(root, 'secret.ts'), SECRET_SOURCE);
    const { exitCode, stdout, stderr } = runScanCore(['secret.ts'], {
      stdinContent: '',
      cwd: root,
    });
    expect(exitCode).toBe(EXIT_FINDINGS);
    expect(stdout).toBe('');
    expect(stderr).toContain('potential secret(s) found');
  });

  it('text format: clean scan writes "no secrets found" to stderr', () => {
    const root = makeFixtureDir('run-scan-text-clean');
    writeFileSync(join(root, 'util.ts'), CLEAN_SOURCE);
    const { exitCode, stdout, stderr } = runScanCore(['util.ts'], {
      stdinContent: '',
      cwd: root,
    });
    expect(exitCode).toBe(EXIT_CLEAN);
    expect(stdout).toBe('');
    expect(stderr).toContain('no secrets found');
  });

  it('--stdin mode uses stdinContent and attributes to --filename', () => {
    const root = makeFixtureDir('run-scan-stdin');
    const { exitCode, stdout } = runScanCore(
      ['--stdin', '--filename', 'piped.ts', '--json'],
      { stdinContent: SECRET_SOURCE, cwd: root },
    );
    expect(exitCode).toBe(EXIT_FINDINGS);
    const parsed = JSON.parse(stdout) as { findings: { file: string }[] };
    expect(parsed.findings[0].file).toBe('piped.ts');
  });

  it('--stdin with missing --filename → exit 2', () => {
    const root = makeFixtureDir('run-scan-stdin-nofile');
    const { exitCode } = runScanCore(['--stdin'], { stdinContent: '', cwd: root });
    expect(exitCode).toBe(EXIT_USAGE);
  });

  it('--json and --sarif together → exit 2', () => {
    const root = makeFixtureDir('run-scan-conflict');
    const { exitCode, stderr } = runScanCore(['--json', '--sarif'], {
      stdinContent: '',
      cwd: root,
    });
    expect(exitCode).toBe(EXIT_USAGE);
    expect(stderr).toContain('mutually exclusive');
  });

  it('determinism: scanning the same fixture twice yields byte-identical JSON', () => {
    const root = makeFixtureDir('run-scan-determinism');
    writeFileSync(join(root, 'a.ts'), SECRET_SOURCE);
    writeFileSync(join(root, 'b.ts'), `const t = "${GH_TOKEN}";\n`);
    const r1 = runScanCore(['--json'], { stdinContent: '', cwd: root });
    const r2 = runScanCore(['--json'], { stdinContent: '', cwd: root });
    expect(r1.stdout).toBe(r2.stdout);
  });
});

// ---------------------------------------------------------------------------
// mainCore — top-level dispatch
// ---------------------------------------------------------------------------

describe('mainCore', () => {
  const io = { stdinContent: '', cwd: tmpRoot };

  it('no args → exit 2, prints usage to stdout', () => {
    const { exitCode, stdout } = mainCore([], io);
    expect(exitCode).toBe(EXIT_USAGE);
    expect(stdout).toContain('leakerlens');
  });

  it('-h → exit 0, prints usage', () => {
    const { exitCode, stdout } = mainCore(['-h'], io);
    expect(exitCode).toBe(EXIT_CLEAN);
    expect(stdout).toBe(USAGE);
  });

  it('--help → exit 0, prints usage', () => {
    const { exitCode, stdout } = mainCore(['--help'], io);
    expect(exitCode).toBe(EXIT_CLEAN);
    expect(stdout).toBe(USAGE);
  });

  it('scan --help → exit 0, prints usage', () => {
    const { exitCode, stdout } = mainCore(['scan', '--help'], io);
    expect(exitCode).toBe(EXIT_CLEAN);
    expect(stdout).toBe(USAGE);
  });

  it('scan -h → exit 0, prints usage', () => {
    const { exitCode, stdout } = mainCore(['scan', '-h'], io);
    expect(exitCode).toBe(EXIT_CLEAN);
    expect(stdout).toBe(USAGE);
  });

  it('unknown command → exit 2, error on stderr', () => {
    const { exitCode, stderr } = mainCore(['deploy'], io);
    expect(exitCode).toBe(EXIT_USAGE);
    expect(stderr).toContain("unknown command 'deploy'");
    expect(stderr).toContain(USAGE);
  });

  it('scan subcommand dispatches correctly (exit 0 for clean dir)', () => {
    const root = makeFixtureDir('main-scan-clean');
    writeFileSync(join(root, 'util.ts'), CLEAN_SOURCE);
    const { exitCode } = mainCore(['scan', 'util.ts'], { stdinContent: '', cwd: root });
    expect(exitCode).toBe(EXIT_CLEAN);
  });

  it('scan subcommand dispatches correctly (exit 1 for secret)', () => {
    const root = makeFixtureDir('main-scan-secret');
    writeFileSync(join(root, 'secret.ts'), SECRET_SOURCE);
    const { exitCode } = mainCore(['scan', '--json', 'secret.ts'], {
      stdinContent: '',
      cwd: root,
    });
    expect(exitCode).toBe(EXIT_FINDINGS);
  });
});

// ---------------------------------------------------------------------------
// EXCLUDED_DIRS integration — secrets in excluded subdirs are not reported
// ---------------------------------------------------------------------------

describe('EXCLUDED_DIRS integration via scanFiles', () => {
  it('secret inside node_modules/ is not reported', () => {
    const root = makeFixtureDir('excl-node_modules');
    mkdirSync(join(root, 'node_modules', 'evil'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'evil', 'index.ts'), SECRET_SOURCE);
    expect(scanFiles(root, [])).toHaveLength(0);
  });

  it('secret inside dist/ is not reported', () => {
    const root = makeFixtureDir('excl-dist');
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist', 'bundle.js'), SECRET_SOURCE);
    expect(scanFiles(root, [])).toHaveLength(0);
  });

  it('secret in a legitimate dir alongside an excluded dir is reported', () => {
    const root = makeFixtureDir('excl-mixed');
    mkdirSync(join(root, 'dist'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'dist', 'bundle.js'), SECRET_SOURCE);
    writeFileSync(join(root, 'src', 'clean.ts'), CLEAN_SOURCE);
    writeFileSync(join(root, 'src', 'secret.ts'), SECRET_SOURCE);
    const results = scanFiles(root, []);
    expect(results.every((r) => r.file.startsWith('src/'))).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Constant exports
// ---------------------------------------------------------------------------

describe('exported constants', () => {
  it('EXIT_CLEAN is 0', () => expect(EXIT_CLEAN).toBe(0));
  it('EXIT_FINDINGS is 1', () => expect(EXIT_FINDINGS).toBe(1));
  it('EXIT_USAGE is 2', () => expect(EXIT_USAGE).toBe(2));
  it('USAGE is a non-empty string', () => {
    expect(typeof USAGE).toBe('string');
    expect(USAGE.length).toBeGreaterThan(0);
  });
});
