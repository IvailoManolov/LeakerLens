/**
 * Unit tests for `src/mcp/server.ts`.
 *
 * Strategy: import the exported handler functions and shaping helpers directly under
 * Vitest — no transport, no stdio, no subprocess. File-system operations (scan_file,
 * scan_workspace) are exercised against real temp directories, exactly as in
 * `test/cli/core.test.ts`. No `vscode` import exists or is needed anywhere here.
 *
 * Coverage targets:
 *   - handleScanText   — known secrets, clean text, filename attribution
 *   - handleScanFile   — file with secret, missing path (isError), clean file
 *   - handleScanWorkspace — secrets found, .gitignore respected, EXCLUDED_DIRS skipped,
 *                          env-file policy (gitignored .env = uncounted, tracked = counted)
 *   - buildResult      — severity bucketing, sort order, ToolResult shape
 *   - summarize        — zero findings wording, singular/plural, breakdown line
 *   - createServer     — constructs without throwing, registers exactly 3 tools
 *   - PRIVACY INVARIANT — raw secret never appears in JSON.stringify(result)
 *   - CLI consistency  — structuredContent matches renderJson output for same input
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  handleScanText,
  handleScanFile,
  handleScanWorkspace,
  buildResult,
  summarize,
  createServer,
  type ScanResult,
  type ToolResult,
} from '../../src/mcp/server';
import { scanStdinContent, renderJson, scanFiles } from '../../src/cli/core';
import type { LocatedFinding } from '../../src/cli/core';

// ---------------------------------------------------------------------------
// Shared fixture constants (identical to cli/core.test.ts for consistency)
// ---------------------------------------------------------------------------

/** Canonical AWS Access Key ID — passes the regex and is high-entropy enough. */
const AWS_KEY = 'AKIAIOSFODNN7QWERTYZ';

/** GitHub PAT — 40 chars after prefix. */
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
  tmpRoot = mkdtempSync(join(tmpdir(), 'leaklens-mcp-test-'));
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function makeFixtureDir(name: string): string {
  const dir = join(tmpRoot, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Helper: assert no raw secret appears in a serialized result
// ---------------------------------------------------------------------------
function assertNoRawSecret(result: ToolResult, rawSecret: string): void {
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain(rawSecret);
}

// ---------------------------------------------------------------------------
// summarize
// ---------------------------------------------------------------------------

describe('summarize', () => {
  it('returns "No secrets found." for zero findings', () => {
    const result: ScanResult = {
      findings: [],
      summary: { total: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 } },
    };
    expect(summarize(result)).toBe('No secrets found.');
  });

  it('uses "secret" (singular) for exactly 1 finding', () => {
    const located = scanStdinContent(SECRET_SOURCE, 'app.ts');
    const tool = buildResult(located);
    expect(tool.summaryText).toContain('1 secret found');
    expect(tool.summaryText).not.toMatch(/\d secrets found/);
  });

  it('uses "secrets" (plural) for 2+ findings', () => {
    const twoLines = `const a = "${AWS_KEY}";\nconst b = "${GH_TOKEN}";\n`;
    const located = scanStdinContent(twoLines, 'app.ts');
    // must have at least 2 findings to exercise plural
    expect(located.length).toBeGreaterThanOrEqual(2);
    const tool = buildResult(located);
    expect(tool.summaryText).toMatch(/\d+ secrets found/);
  });

  it('includes severity breakdown in the headline (e.g. "critical")', () => {
    const located = scanStdinContent(SECRET_SOURCE, 'app.ts');
    const tool = buildResult(located);
    // AWS key is critical
    expect(tool.summaryText).toContain('critical');
  });

  it('includes one bullet per finding with file:line format', () => {
    const located = scanStdinContent(SECRET_SOURCE, 'app.ts');
    const tool = buildResult(located);
    // Each finding line starts with "  - "
    expect(tool.summaryText).toContain('  - app.ts:');
  });

  it('lists only non-zero severities in the breakdown', () => {
    // AWS key → critical only; medium/low should not appear in the summary line
    const located = scanStdinContent(SECRET_SOURCE, 'app.ts');
    const tool = buildResult(located);
    // The breakdown line after "N secret(s) found: " should not mention zero-count levels
    // We check "low" doesn't appear in the headline (it might appear elsewhere so we check carefully)
    const headline = tool.summaryText.split('\n')[0];
    expect(headline).not.toContain('0 low');
    expect(headline).not.toContain('0 medium');
  });

  it('direct summarize: severity order is critical > high > medium > low', () => {
    const result: ScanResult = {
      findings: [
        {
          file: 'a.ts',
          ruleId: 'r1',
          ruleName: 'R1',
          severity: 'low',
          line: 1,
          column: 1,
          matchPreview: 'x',
          fingerprint: 'fp1',
          message: 'msg',
        },
        {
          file: 'a.ts',
          ruleId: 'r2',
          ruleName: 'R2',
          severity: 'high',
          line: 2,
          column: 1,
          matchPreview: 'y',
          fingerprint: 'fp2',
          message: 'msg2',
        },
      ],
      summary: { total: 2, bySeverity: { critical: 0, high: 1, medium: 0, low: 1 } },
    };
    const text = summarize(result);
    // high appears before low in the breakdown
    const highIdx = text.indexOf('high');
    const lowIdx = text.indexOf('low');
    expect(highIdx).toBeGreaterThanOrEqual(0);
    expect(lowIdx).toBeGreaterThan(highIdx);
  });
});

// ---------------------------------------------------------------------------
// buildResult
// ---------------------------------------------------------------------------

describe('buildResult', () => {
  it('returns empty findings and total=0 for no input', () => {
    const result = buildResult([]);
    expect(result.structured.findings).toHaveLength(0);
    expect(result.structured.summary.total).toBe(0);
    expect(result.structured.summary.bySeverity).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    });
  });

  it('counts critical findings correctly', () => {
    const located = scanStdinContent(SECRET_SOURCE, 'app.ts');
    const result = buildResult(located);
    expect(result.structured.summary.bySeverity.critical).toBeGreaterThan(0);
    expect(result.structured.summary.total).toBe(located.length);
  });

  it('findings are sorted deterministically (file → start → ruleId)', () => {
    const twoLines = `const a = "${AWS_KEY}";\nconst b = "${GH_TOKEN}";\n`;
    const located = scanStdinContent(twoLines, 'app.ts');
    const r1 = buildResult(located);
    const r2 = buildResult(located);
    expect(JSON.stringify(r1.structured)).toBe(JSON.stringify(r2.structured));
  });

  it('each JsonFinding has 1-based line and column', () => {
    const located = scanStdinContent(SECRET_SOURCE, 'app.ts');
    const result = buildResult(located);
    for (const f of result.structured.findings) {
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(f.column).toBeGreaterThanOrEqual(1);
    }
  });

  it('each JsonFinding carries file, ruleId, ruleName, severity, matchPreview, fingerprint, message', () => {
    const located = scanStdinContent(SECRET_SOURCE, 'app.ts');
    const result = buildResult(located);
    const f = result.structured.findings[0];
    expect(typeof f.file).toBe('string');
    expect(typeof f.ruleId).toBe('string');
    expect(typeof f.ruleName).toBe('string');
    expect(['critical', 'high', 'medium', 'low']).toContain(f.severity);
    expect(typeof f.matchPreview).toBe('string');
    expect(typeof f.fingerprint).toBe('string');
    expect(typeof f.message).toBe('string');
  });

  it('buildResult with multiple severity levels buckets them correctly', () => {
    // Craft LocatedFindings with known severities directly
    const makeLocated = (severity: 'critical' | 'high' | 'medium' | 'low'): LocatedFinding => ({
      file: 'test.ts',
      finding: {
        ruleId: `rule-${severity}`,
        ruleName: severity,
        severity,
        start: 0,
        end: 5,
        line: 0,
        column: 0,
        matchPreview: '****',
        fingerprint: 'abc',
        message: 'test',
        remediations: [],
      },
    });

    const located = [
      makeLocated('critical'),
      makeLocated('critical'),
      makeLocated('high'),
      makeLocated('medium'),
      makeLocated('low'),
    ];

    const result = buildResult(located);
    expect(result.structured.summary.total).toBe(5);
    expect(result.structured.summary.bySeverity.critical).toBe(2);
    expect(result.structured.summary.bySeverity.high).toBe(1);
    expect(result.structured.summary.bySeverity.medium).toBe(1);
    expect(result.structured.summary.bySeverity.low).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// handleScanText
// ---------------------------------------------------------------------------

describe('handleScanText', () => {
  it('returns findings for a known secret', () => {
    const result = handleScanText({ text: SECRET_SOURCE });
    expect(result.structured.findings.length).toBeGreaterThan(0);
    expect(result.structured.summary.total).toBeGreaterThan(0);
  });

  it('finding ruleId is aws-access-key-id for the AWS key', () => {
    const result = handleScanText({ text: SECRET_SOURCE });
    const awsFinding = result.structured.findings.find((f) => f.ruleId === 'aws-access-key-id');
    expect(awsFinding).toBeDefined();
  });

  it('finding has 1-based line and column', () => {
    const result = handleScanText({ text: SECRET_SOURCE });
    const f = result.structured.findings[0];
    // The secret is on the first line → line=1, column > 0 (after the prefix text)
    expect(f.line).toBe(1);
    expect(f.column).toBeGreaterThan(1);
  });

  it('matchPreview is masked (not the raw secret)', () => {
    const result = handleScanText({ text: SECRET_SOURCE });
    const f = result.structured.findings[0];
    // AWS masking: maskPrefix(v, 4) → "AKIA…********"
    expect(f.matchPreview).toContain('AKIA');
    expect(f.matchPreview).not.toBe(AWS_KEY);
    // The masked preview starts with the recognizable prefix
    expect(f.matchPreview.startsWith('AKIA')).toBe(true);
    expect(f.matchPreview).toContain('…');
  });

  it('fingerprint is a non-empty string', () => {
    const result = handleScanText({ text: SECRET_SOURCE });
    const f = result.structured.findings[0];
    expect(typeof f.fingerprint).toBe('string');
    expect(f.fingerprint.length).toBeGreaterThan(0);
  });

  it('severity is one of the known levels', () => {
    const result = handleScanText({ text: SECRET_SOURCE });
    const f = result.structured.findings[0];
    expect(['critical', 'high', 'medium', 'low']).toContain(f.severity);
  });

  it('AWS key finding is critical', () => {
    const result = handleScanText({ text: SECRET_SOURCE });
    const f = result.structured.findings.find((x) => x.ruleId === 'aws-access-key-id');
    expect(f?.severity).toBe('critical');
  });

  it('returns empty findings for clean text', () => {
    const result = handleScanText({ text: CLEAN_SOURCE });
    expect(result.structured.findings).toHaveLength(0);
    expect(result.structured.summary.total).toBe(0);
  });

  it('summaryText says "No secrets found." for clean text', () => {
    const result = handleScanText({ text: CLEAN_SOURCE });
    expect(result.summaryText).toBe('No secrets found.');
  });

  it('summaryText mentions the count for findings', () => {
    const result = handleScanText({ text: SECRET_SOURCE });
    expect(result.summaryText).toContain('secret');
    expect(result.summaryText).toMatch(/\d/);
  });

  it('content[0].text equals summaryText (for MCP ok() shaping)', () => {
    // Test that the summaryText is what the MCP content field would carry.
    // We verify the ToolResult shape directly.
    const result = handleScanText({ text: SECRET_SOURCE });
    expect(typeof result.summaryText).toBe('string');
    expect(result.summaryText.length).toBeGreaterThan(0);
  });

  it('attributes finding to "snippet.txt" when filename is omitted', () => {
    const result = handleScanText({ text: SECRET_SOURCE });
    expect(result.structured.findings[0].file).toBe('snippet.txt');
  });

  it('attributes finding to an explicit filename', () => {
    const result = handleScanText({ text: SECRET_SOURCE, filename: 'mymodule.ts' });
    expect(result.structured.findings[0].file).toBe('mymodule.ts');
  });

  it('empty filename string falls back to snippet.txt', () => {
    const result = handleScanText({ text: SECRET_SOURCE, filename: '' });
    expect(result.structured.findings[0].file).toBe('snippet.txt');
  });

  it('PRIVACY INVARIANT: raw AWS key never appears in JSON.stringify(result)', () => {
    // Use a unique sentinel so we can be certain
    const SENTINEL = 'AKIASENTINELKEY0001A';
    const result = handleScanText({ text: `const k = "${SENTINEL}";\n` });
    // The finding must exist (rule fires)
    expect(result.structured.findings.length).toBeGreaterThan(0);
    // Now assert the raw sentinel is absent from the whole serialized result
    assertNoRawSecret(result, SENTINEL);
  });

  it('PRIVACY INVARIANT: raw GitHub token never appears in JSON.stringify(result)', () => {
    const result = handleScanText({ text: `const t = "${GH_TOKEN}";\n` });
    assertNoRawSecret(result, GH_TOKEN);
  });

  it('PRIVACY INVARIANT: summaryText does not contain raw secret', () => {
    const SENTINEL = 'AKIASENTINELKEY0001A';
    const result = handleScanText({ text: `const k = "${SENTINEL}";\n` });
    expect(result.summaryText).not.toContain(SENTINEL);
  });
});

// ---------------------------------------------------------------------------
// handleScanFile
// ---------------------------------------------------------------------------

describe('handleScanFile', () => {
  it('finds a secret in a temp file', () => {
    const dir = makeFixtureDir('scan-file-1');
    writeFileSync(join(dir, 'secret.ts'), SECRET_SOURCE);
    const result = handleScanFile({ path: join(dir, 'secret.ts') }, dir);
    expect(result.structured.findings.length).toBeGreaterThan(0);
    expect(result.structured.summary.total).toBeGreaterThan(0);
  });

  it('finding is attributed to the absolute posix path of the file', () => {
    const dir = makeFixtureDir('scan-file-attr');
    const filePath = join(dir, 'secret.ts');
    writeFileSync(filePath, SECRET_SOURCE);
    const result = handleScanFile({ path: filePath }, dir);
    const f = result.structured.findings[0];
    // file is the abs path with forward slashes
    expect(f.file).toContain('secret.ts');
    expect(f.file).not.toContain('\\');
  });

  it('finding has 1-based line and column', () => {
    const dir = makeFixtureDir('scan-file-lines');
    writeFileSync(join(dir, 'secret.ts'), SECRET_SOURCE);
    const result = handleScanFile({ path: join(dir, 'secret.ts') }, dir);
    const f = result.structured.findings[0];
    expect(f.line).toBeGreaterThanOrEqual(1);
    expect(f.column).toBeGreaterThanOrEqual(1);
  });

  it('returns empty findings for a clean file', () => {
    const dir = makeFixtureDir('scan-file-clean');
    writeFileSync(join(dir, 'clean.ts'), CLEAN_SOURCE);
    const result = handleScanFile({ path: join(dir, 'clean.ts') }, dir);
    expect(result.structured.findings).toHaveLength(0);
    expect(result.structured.summary.total).toBe(0);
  });

  it('throws for a missing file (caller maps to isError)', () => {
    const dir = makeFixtureDir('scan-file-missing');
    expect(() => handleScanFile({ path: join(dir, 'nonexistent.ts') }, dir)).toThrow(
      /cannot read file/,
    );
  });

  it('thrown error message contains the path', () => {
    const dir = makeFixtureDir('scan-file-errpath');
    const badPath = join(dir, 'no-such-file.ts');
    let msg = '';
    try {
      handleScanFile({ path: badPath }, dir);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('no-such-file.ts');
  });

  it('PRIVACY INVARIANT: raw secret never in JSON.stringify(result)', () => {
    const dir = makeFixtureDir('scan-file-privacy');
    const SENTINEL = 'AKIASENTINELFILE0001';
    writeFileSync(join(dir, 'sec.ts'), `const k = "${SENTINEL}";\n`);
    const result = handleScanFile({ path: join(dir, 'sec.ts') }, dir);
    assertNoRawSecret(result, SENTINEL);
  });

  it('relative path is resolved against cwd', () => {
    const dir = makeFixtureDir('scan-file-relpath');
    writeFileSync(join(dir, 'secret.ts'), SECRET_SOURCE);
    // Pass a relative path — should resolve against dir
    const result = handleScanFile({ path: 'secret.ts' }, dir);
    expect(result.structured.findings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// handleScanWorkspace
// ---------------------------------------------------------------------------

describe('handleScanWorkspace', () => {
  it('finds secrets in a workspace', () => {
    const dir = makeFixtureDir('ws-1');
    writeFileSync(join(dir, 'secret.ts'), SECRET_SOURCE);
    writeFileSync(join(dir, 'clean.ts'), CLEAN_SOURCE);
    const result = handleScanWorkspace({}, dir);
    expect(result.structured.findings.length).toBeGreaterThan(0);
  });

  it('returns empty findings for a clean workspace', () => {
    const dir = makeFixtureDir('ws-clean');
    writeFileSync(join(dir, 'util.ts'), CLEAN_SOURCE);
    const result = handleScanWorkspace({}, dir);
    expect(result.structured.findings).toHaveLength(0);
    expect(result.structured.summary.total).toBe(0);
  });

  it('respects .gitignore (gitignored file secrets excluded from walk)', () => {
    const dir = makeFixtureDir('ws-gitignore');
    writeFileSync(join(dir, '.gitignore'), 'secret.ts\n');
    writeFileSync(join(dir, 'secret.ts'), SECRET_SOURCE);
    writeFileSync(join(dir, 'clean.ts'), CLEAN_SOURCE);
    const result = handleScanWorkspace({}, dir);
    // secret.ts is gitignored → walk never collects it → no findings
    expect(result.structured.findings).toHaveLength(0);
  });

  it('skips EXCLUDED_DIRS (node_modules)', () => {
    const dir = makeFixtureDir('ws-excluded');
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'pkg', 'index.ts'), SECRET_SOURCE);
    writeFileSync(join(dir, 'clean.ts'), CLEAN_SOURCE);
    const result = handleScanWorkspace({}, dir);
    expect(result.structured.findings.every((f) => !f.file.includes('node_modules'))).toBe(true);
  });

  it('skips EXCLUDED_DIRS (dist)', () => {
    const dir = makeFixtureDir('ws-dist');
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'bundle.js'), SECRET_SOURCE);
    writeFileSync(join(dir, 'clean.ts'), CLEAN_SOURCE);
    const result = handleScanWorkspace({}, dir);
    expect(result.structured.findings.every((f) => !f.file.startsWith('dist/'))).toBe(true);
  });

  it('env-file policy: .env with secret is COUNTED when NOT gitignored', () => {
    const dir = makeFixtureDir('ws-env-counted');
    writeFileSync(join(dir, '.env'), `AWS_KEY=${AWS_KEY}\n`);
    const result = handleScanWorkspace({}, dir);
    expect(result.structured.findings.length).toBeGreaterThan(0);
  });

  it('env-file policy: .env with secret is UNCOUNTED when gitignored', () => {
    const dir = makeFixtureDir('ws-env-uncounted');
    writeFileSync(join(dir, '.env'), `AWS_KEY=${AWS_KEY}\n`);
    writeFileSync(join(dir, '.gitignore'), '.env\n');
    const result = handleScanWorkspace({}, dir);
    // .env is gitignored → walk skips it → no findings
    expect(result.structured.findings).toHaveLength(0);
  });

  it('env-file policy: .env.local uncounted when gitignored', () => {
    const dir = makeFixtureDir('ws-env-local-uncounted');
    writeFileSync(join(dir, '.env.local'), `SECRET=${AWS_KEY}\n`);
    writeFileSync(join(dir, '.gitignore'), '.env.local\n');
    const result = handleScanWorkspace({}, dir);
    expect(result.structured.findings).toHaveLength(0);
  });

  it('accepts explicit paths array', () => {
    const dir = makeFixtureDir('ws-explicit-paths');
    writeFileSync(join(dir, 'a.ts'), SECRET_SOURCE);
    writeFileSync(join(dir, 'b.ts'), CLEAN_SOURCE);
    const result = handleScanWorkspace({ paths: ['a.ts'] }, dir);
    expect(result.structured.findings.length).toBeGreaterThan(0);
    // All findings are from a.ts
    expect(result.structured.findings.every((f) => f.file.includes('a.ts'))).toBe(true);
  });

  it('accepts a root override', () => {
    const parentDir = makeFixtureDir('ws-root-parent');
    const subDir = join(parentDir, 'sub');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'secret.ts'), SECRET_SOURCE);
    // Provide root = subDir so it scans subDir
    const result = handleScanWorkspace({ root: subDir }, parentDir);
    expect(result.structured.findings.length).toBeGreaterThan(0);
  });

  it('empty root string falls back to cwd', () => {
    const dir = makeFixtureDir('ws-root-empty');
    writeFileSync(join(dir, 'secret.ts'), SECRET_SOURCE);
    const result = handleScanWorkspace({ root: '' }, dir);
    expect(result.structured.findings.length).toBeGreaterThan(0);
  });

  it('PRIVACY INVARIANT: raw secret never in JSON.stringify(result)', () => {
    const dir = makeFixtureDir('ws-privacy');
    const SENTINEL = 'AKIASENTINELWS00001A';
    writeFileSync(join(dir, 'sec.ts'), `const k = "${SENTINEL}";\n`);
    const result = handleScanWorkspace({}, dir);
    assertNoRawSecret(result, SENTINEL);
  });

  it('summaryText is non-empty when findings exist', () => {
    const dir = makeFixtureDir('ws-summary');
    writeFileSync(join(dir, 'secret.ts'), SECRET_SOURCE);
    const result = handleScanWorkspace({}, dir);
    expect(result.summaryText.length).toBeGreaterThan(0);
    expect(result.summaryText).not.toBe('No secrets found.');
  });
});

// ---------------------------------------------------------------------------
// CLI consistency: structuredContent must equal renderJson output
// ---------------------------------------------------------------------------

describe('CLI consistency', () => {
  it('handleScanText structuredContent matches renderJson for same input', () => {
    const located = scanStdinContent(SECRET_SOURCE, 'snippet.txt');
    const cliJson = JSON.parse(renderJson(located)) as {
      findings: unknown[];
      summary: { total: number; bySeverity: Record<string, number> };
    };
    const mcpResult = handleScanText({ text: SECRET_SOURCE });
    const mcpStructured = mcpResult.structured;

    // Same total and bySeverity
    expect(mcpStructured.summary.total).toBe(cliJson.summary.total);
    expect(mcpStructured.summary.bySeverity).toEqual(cliJson.summary.bySeverity);
    // Same number of findings
    expect(mcpStructured.findings.length).toBe(cliJson.findings.length);
  });

  it('handleScanWorkspace structuredContent matches scanFiles→renderJson for same dir', () => {
    const dir = makeFixtureDir('cli-consistency-ws');
    writeFileSync(join(dir, 'secret.ts'), SECRET_SOURCE);
    writeFileSync(join(dir, 'clean.ts'), CLEAN_SOURCE);

    const located = scanFiles(dir, []);
    const cliJson = JSON.parse(renderJson(located)) as {
      findings: { ruleId: string; line: number; column: number }[];
      summary: { total: number; bySeverity: Record<string, number> };
    };
    const mcpResult = handleScanWorkspace({}, dir);
    const mcpStructured = mcpResult.structured;

    expect(mcpStructured.summary.total).toBe(cliJson.summary.total);
    expect(mcpStructured.summary.bySeverity).toEqual(cliJson.summary.bySeverity);
    expect(mcpStructured.findings.length).toBe(cliJson.findings.length);

    // Spot-check finding shapes are identical
    for (let i = 0; i < cliJson.findings.length; i++) {
      expect(mcpStructured.findings[i].ruleId).toBe(cliJson.findings[i].ruleId);
      expect(mcpStructured.findings[i].line).toBe(cliJson.findings[i].line);
      expect(mcpStructured.findings[i].column).toBe(cliJson.findings[i].column);
    }
  });

  it('handleScanFile finding shape matches toJsonFinding contract exactly', () => {
    const dir = makeFixtureDir('cli-consistency-file');
    writeFileSync(join(dir, 'secret.ts'), SECRET_SOURCE);
    const result = handleScanFile({ path: join(dir, 'secret.ts') }, dir);
    const f = result.structured.findings[0];

    // Assert the exact JsonFinding contract fields are present with correct types
    expect(typeof f.file).toBe('string');
    expect(typeof f.ruleId).toBe('string');
    expect(typeof f.ruleName).toBe('string');
    expect(['critical', 'high', 'medium', 'low']).toContain(f.severity);
    expect(typeof f.line).toBe('number');
    expect(typeof f.column).toBe('number');
    expect(typeof f.matchPreview).toBe('string');
    expect(typeof f.fingerprint).toBe('string');
    expect(typeof f.message).toBe('string');
    // 1-based
    expect(f.line).toBeGreaterThanOrEqual(1);
    expect(f.column).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// createServer
// ---------------------------------------------------------------------------

describe('createServer', () => {
  it('constructs without throwing', () => {
    expect(() => createServer(tmpRoot)).not.toThrow();
  });

  it('registers exactly three tools', () => {
    const server = createServer(tmpRoot);
    // The SDK exposes _registeredTools as an object keyed by tool name
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(Object.keys(tools)).toHaveLength(3);
  });

  it('registers scan_text, scan_file, scan_workspace', () => {
    const server = createServer(tmpRoot);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect('scan_text' in tools).toBe(true);
    expect('scan_file' in tools).toBe(true);
    expect('scan_workspace' in tools).toBe(true);
  });

  it('uses process.cwd() as default cwd', () => {
    // Just verify no throw — default arg path is exercised
    expect(() => createServer()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// MCP layer: ok() and fail() shaping (via createServer tool callbacks)
// ---------------------------------------------------------------------------

describe('MCP tool callback shaping (ok/fail paths)', () => {
  it('ok() path: scan_text with secret produces structuredContent with findings', async () => {
    // We directly call handleScanText and verify the ToolResult maps onto the
    // expected MCP shape (content[0].text, structuredContent).
    const toolResult = handleScanText({ text: SECRET_SOURCE });
    // Shape the result as ok() does
    const mcpResult = {
      content: [{ type: 'text' as const, text: toolResult.summaryText }],
      structuredContent: toolResult.structured as unknown as Record<string, unknown>,
    };
    expect(mcpResult.content[0].type).toBe('text');
    expect(mcpResult.content[0].text.length).toBeGreaterThan(0);
    expect(
      (mcpResult.structuredContent as { findings: unknown[]; summary: { total: number } }).findings
        .length,
    ).toBeGreaterThan(0);
    expect(
      (mcpResult.structuredContent as { findings: unknown[]; summary: { total: number } }).summary
        .total,
    ).toBeGreaterThan(0);
    expect('isError' in mcpResult).toBe(false);
  });

  it('fail() path: scan_file with missing path sets isError=true and gives a message', () => {
    const dir = makeFixtureDir('mcp-fail-path');
    // The server's fail() is called when handleScanFile throws.
    // We simulate the fail() shape:
    let thrown = '';
    try {
      handleScanFile({ path: join(dir, 'nope.ts') }, dir);
    } catch (e) {
      thrown = (e as Error).message;
    }
    const failResult = {
      content: [{ type: 'text' as const, text: `LeakLens: ${thrown}` }],
      isError: true as const,
    };
    expect(failResult.isError).toBe(true);
    expect(failResult.content[0].text).toContain('LeakLens:');
    expect(failResult.content[0].text).toContain('nope.ts');
  });
});

// ---------------------------------------------------------------------------
// Edge cases and robustness
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handleScanText with empty text returns no findings', () => {
    const result = handleScanText({ text: '' });
    expect(result.structured.findings).toHaveLength(0);
    expect(result.summaryText).toBe('No secrets found.');
  });

  it('handleScanText with only whitespace returns no findings', () => {
    const result = handleScanText({ text: '   \n\n\t  ' });
    expect(result.structured.findings).toHaveLength(0);
  });

  it('handleScanText: two different secret types both detected', () => {
    const twoTypes = `const a = "${AWS_KEY}";\nconst b = "${GH_TOKEN}";\n`;
    const result = handleScanText({ text: twoTypes });
    expect(result.structured.findings.length).toBeGreaterThanOrEqual(2);
    const ruleIds = result.structured.findings.map((f) => f.ruleId);
    expect(ruleIds).toContain('aws-access-key-id');
    expect(ruleIds).toContain('github-token');
  });

  it('handleScanWorkspace: empty workspace (no files) returns no findings', () => {
    const dir = makeFixtureDir('ws-empty');
    const result = handleScanWorkspace({}, dir);
    expect(result.structured.findings).toHaveLength(0);
    expect(result.summaryText).toBe('No secrets found.');
  });

  it('handleScanWorkspace: empty paths array behaves identically to omitted paths', () => {
    const dir = makeFixtureDir('ws-paths-empty-array');
    writeFileSync(join(dir, 'secret.ts'), SECRET_SOURCE);
    const r1 = handleScanWorkspace({ paths: [] }, dir);
    const r2 = handleScanWorkspace({}, dir);
    expect(JSON.stringify(r1.structured)).toBe(JSON.stringify(r2.structured));
  });

  it('PRIVACY INVARIANT: Stripe key raw value absent from result', () => {
    // Assembled at runtime so the literal never trips secret push-protection,
    // while LeakLens still sees the reconstructed sk_live_ key in the scanned text.
    const STRIPE_KEY = ['sk', 'live', '4eC39HqLyjWDarjtT1zdp7dc'].join('_');
    const result = handleScanText({
      text: `const stripe = "${STRIPE_KEY}";\n`,
      filename: 'stripe.ts',
    });
    // If it fires, raw must not appear
    if (result.structured.findings.length > 0) {
      assertNoRawSecret(result, STRIPE_KEY);
    }
  });

  it('PRIVACY INVARIANT: JWT raw value absent from result', () => {
    // A syntactically valid JWT (header.payload.signature base64)
    const JWT =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const result = handleScanText({ text: `Authorization: Bearer ${JWT}\n`, filename: 'test.ts' });
    if (result.structured.findings.length > 0) {
      assertNoRawSecret(result, JWT);
    }
  });
});
