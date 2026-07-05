/**
 * Exported pure-ish core of the headless `leaklens` CLI.  Every function here is
 * importable by unit tests without spawning a subprocess and without touching
 * `process.exit` / `process.argv`.  The thin entry-point (`index.ts`) wires these
 * together with `process.stdin`, `process.cwd()`, and `process.exit`.
 *
 * I/O boundaries deliberately remain in `index.ts` (stdin reading, cwd lookup, exit).
 * The only "impure" operations retained here are the filesystem calls inside
 * `collectFiles` / `buildIgnore` / `scanFiles` — they are controlled in tests via
 * a real temp-directory fixture, not mocks.
 */
import { readFileSync, readdirSync, statSync, type Stats } from 'fs';
import { dirname, isAbsolute, join, relative, resolve } from 'path';
import ignore, { type Ignore } from 'ignore';
import { scanText, isEnvFile, type Finding, type Severity } from '../engine';
import { EXCLUDED_DIRS } from '../engine/scope';

// ---------------------------------------------------------------------------
// Exit codes
// ---------------------------------------------------------------------------

export const EXIT_CLEAN = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_USAGE = 2;

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

export const USAGE = `leaklens — local secret scanner (no network, no telemetry)

Usage:
  leaklens scan [paths...]        Scan files/dirs (default: current directory)
  leaklens scan --stdin --filename <name>
                                  Scan stdin as <name>
  leaklens mcp                    Start the local stdio MCP server (for AI agents)

Options:
  --json                          Machine output: { findings, summary } to stdout
  --sarif                         SARIF 2.1.0 output to stdout (GitHub code scanning)
  --stdin                         Read the document from stdin
  --filename <name>               Filename to attribute --stdin content to
  -h, --help                      Show this help

Exit codes: 0 = clean, 1 = findings present, 2 = usage/IO error.
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Output format chosen on the command line. */
export type Format = 'text' | 'json' | 'sarif';

/** Parsed `scan` invocation. */
export interface ScanArgs {
  readonly paths: string[];
  readonly format: Format;
  readonly stdin: boolean;
  readonly stdinFilename: string | undefined;
}

/** A finding paired with the workspace-relative path of the file it came from. */
export interface LocatedFinding {
  readonly file: string;
  readonly finding: Finding;
}

/** The JSON shape emitted by `--json`. Never carries raw secret values. */
export interface JsonFinding {
  readonly file: string;
  readonly ruleId: string;
  readonly ruleName: string;
  readonly severity: Severity;
  /** 1-based for output. */
  readonly line: number;
  /** 1-based for output. */
  readonly column: number;
  readonly matchPreview: string;
  readonly fingerprint: string;
  readonly message: string;
}

/** A file discovered by the walk, with paths the scanner needs. */
export interface WalkedFile {
  readonly abs: string;
  readonly relPosix: string;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse `scan` arguments. Throws a usage `Error` for unknown flags, conflicting output
 * formats, or a `--stdin` missing its `--filename`.
 */
export function parseScanArgs(argv: readonly string[]): ScanArgs {
  const paths: string[] = [];
  let format: Format = 'text';
  let stdin = false;
  let stdinFilename: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--json':
      case '--sarif': {
        const next: Format = arg === '--json' ? 'json' : 'sarif';
        if (format !== 'text' && format !== next) {
          throw new Error('--json and --sarif are mutually exclusive');
        }
        format = next;
        break;
      }
      case '--stdin':
        stdin = true;
        break;
      case '--filename': {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('-')) {
          throw new Error('--filename requires a value');
        }
        stdinFilename = value;
        i += 1;
        break;
      }
      default:
        if (arg.startsWith('-')) {
          throw new Error(`unknown option: ${arg}`);
        }
        paths.push(arg);
    }
  }

  if (stdin && stdinFilename === undefined) {
    throw new Error('--stdin requires --filename <name>');
  }
  if (!stdin && stdinFilename !== undefined) {
    throw new Error('--filename is only valid with --stdin');
  }

  return { paths, format, stdin, stdinFilename };
}

// ---------------------------------------------------------------------------
// Gitignore / file-walk helpers
// ---------------------------------------------------------------------------

/**
 * Build a gitignore matcher rooted at `root`. Reads the root `.gitignore` if present plus
 * the extension's excluded dirs, so the walk respects both the user's ignores and our
 * build-output exclusions from one source of truth.
 */
export function buildIgnore(root: string): Ignore {
  const ig = ignore();
  for (const dir of EXCLUDED_DIRS) {
    ig.add(dir + '/');
  }
  try {
    ig.add(readFileSync(join(root, '.gitignore'), 'utf8'));
  } catch {
    // No .gitignore (or unreadable) — only the excluded dirs apply.
  }
  return ig;
}

/** Normalize an absolute path to a `/`-separated path relative to `root`. */
export function toRelPosix(root: string, absPath: string): string {
  // Split on BOTH separators so output is posix on every OS. On Linux `path.sep` is `/`,
  // so splitting on `sep` alone would leave Windows-style `\` in the path.
  return relative(root, absPath).split(/[\\/]/).join('/');
}

/**
 * True when a path relative to `root` is matched by the gitignore matcher. A leading `''`
 * (the root itself) is never ignored. `ignore` requires non-empty, non-absolute paths.
 */
export function isIgnored(ig: Ignore, relPosix: string): boolean {
  if (relPosix === '' || relPosix.startsWith('..')) {
    return false;
  }
  return ig.ignores(relPosix);
}

/**
 * Recursively collect scannable files under `absPath`, skipping anything the gitignore
 * matcher excludes. Sorted later for determinism.
 */
export function walk(root: string, ig: Ignore, absPath: string, into: WalkedFile[]): void {
  let stats: Stats;
  try {
    stats = statSync(absPath);
  } catch {
    return;
  }

  const relPosix = toRelPosix(root, absPath);

  if (stats.isDirectory()) {
    if (relPosix !== '' && isIgnored(ig, relPosix)) {
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(absPath);
    } catch {
      return;
    }
    for (const entry of entries) {
      walk(root, ig, join(absPath, entry), into);
    }
    return;
  }

  if (stats.isFile() && !isIgnored(ig, relPosix)) {
    into.push({ abs: absPath, relPosix });
  }
}

/**
 * Pick the gitignore root for a resolved target. Targets inside `cwd` are rooted at
 * `cwd`; targets outside are self-rooted.
 */
export function rootForTarget(cwd: string, absTarget: string): string {
  const rel = relative(cwd, absTarget);
  if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) {
    return cwd;
  }
  try {
    return statSync(absTarget).isDirectory() ? absTarget : dirname(absTarget);
  } catch {
    return dirname(absTarget);
  }
}

/**
 * Resolve the requested paths to a deduped list of files to scan, each tagged with the
 * gitignore matcher rooted at its base. Defaults to the current directory when no paths
 * are given.
 */
export function collectFiles(
  cwd: string,
  paths: readonly string[],
): { files: WalkedFile[]; ig: Ignore }[] {
  const targets = paths.length > 0 ? paths : ['.'];
  const seen = new Set<string>();
  const byRoot = new Map<string, { ig: Ignore; files: WalkedFile[] }>();
  for (const target of targets) {
    const abs = resolve(cwd, target);
    const root = rootForTarget(cwd, abs);
    let group = byRoot.get(root);
    if (!group) {
      group = { ig: buildIgnore(root), files: [] };
      byRoot.set(root, group);
    }
    const collected: WalkedFile[] = [];
    walk(root, group.ig, abs, collected);
    for (const f of collected) {
      if (!seen.has(f.abs)) {
        seen.add(f.abs);
        group.files.push(f);
      }
    }
  }
  return [...byRoot.values()].map((g) => ({ files: g.files, ig: g.ig }));
}

// ---------------------------------------------------------------------------
// Env-file policy
// ---------------------------------------------------------------------------

/**
 * Decide whether a file's findings count, applying the SAME env-file policy as the editor:
 * a `.env` file that is gitignored is uncounted; a non-gitignored `.env` IS counted.
 */
export function isCounted(ig: Ignore, file: WalkedFile): boolean {
  if (!isEnvFile(file.abs)) {
    return true;
  }
  return !isIgnored(ig, file.relPosix);
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/** Deterministic order: file path, then start offset, then ruleId. */
export function compareLocated(a: LocatedFinding, b: LocatedFinding): number {
  if (a.file !== b.file) {
    return a.file < b.file ? -1 : 1;
  }
  if (a.finding.start !== b.finding.start) {
    return a.finding.start - b.finding.start;
  }
  return a.finding.ruleId.localeCompare(b.finding.ruleId);
}

/**
 * Scan every collected file and gather located findings, applying the env-file policy.
 * Findings are sorted for determinism.
 */
export function scanFiles(cwd: string, paths: readonly string[]): LocatedFinding[] {
  const located: LocatedFinding[] = [];
  for (const { files, ig } of collectFiles(cwd, paths)) {
    for (const file of files) {
      if (!isCounted(ig, file)) {
        continue;
      }
      let text: string;
      try {
        text = readFileSync(file.abs, 'utf8');
      } catch {
        continue;
      }
      for (const finding of scanText(text, { filename: file.abs })) {
        located.push({ file: file.relPosix, finding });
      }
    }
  }
  located.sort(compareLocated);
  return located;
}

/** Scan stdin content as `filename` and return located findings. */
export function scanStdinContent(content: string, filename: string): LocatedFinding[] {
  const relPosix = filename.split(/[\\/]/).join('/');
  return scanText(content, { filename }).map((finding) => ({ file: relPosix, finding }));
}

// ---------------------------------------------------------------------------
// Output rendering
// ---------------------------------------------------------------------------

/** Map a finding to the stable JSON shape (1-based line/column, no raw secret). */
export function toJsonFinding(lf: LocatedFinding): JsonFinding {
  return {
    file: lf.file,
    ruleId: lf.finding.ruleId,
    ruleName: lf.finding.ruleName,
    severity: lf.finding.severity,
    line: lf.finding.line + 1,
    column: lf.finding.column + 1,
    matchPreview: lf.finding.matchPreview,
    fingerprint: lf.finding.fingerprint,
    message: lf.finding.message,
  };
}

/** Build `{ findings, summary }` and serialize as stable, indented JSON. */
export function renderJson(located: readonly LocatedFinding[]): string {
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const findings = located.map((lf) => {
    bySeverity[lf.finding.severity] += 1;
    return toJsonFinding(lf);
  });
  return JSON.stringify({ findings, summary: { total: findings.length, bySeverity } }, null, 2) + '\n';
}

/** SARIF level for a severity: critical/high → error, medium → warning, low → note. */
export function sarifLevel(severity: Severity): 'error' | 'warning' | 'note' {
  if (severity === 'critical' || severity === 'high') {
    return 'error';
  }
  return severity === 'medium' ? 'warning' : 'note';
}

/**
 * Build a valid SARIF 2.1.0 log: one run, driver "LeakLens", `tool.driver.rules[]`,
 * and one result per finding.
 */
export function renderSarif(located: readonly LocatedFinding[]): string {
  const ruleIndex = new Map<string, number>();
  const rules: { id: string; name: string; shortDescription: { text: string } }[] = [];
  for (const { finding } of located) {
    if (!ruleIndex.has(finding.ruleId)) {
      ruleIndex.set(finding.ruleId, rules.length);
      rules.push({
        id: finding.ruleId,
        name: finding.ruleName,
        shortDescription: { text: finding.message },
      });
    }
  }

  const results = located.map(({ file, finding }) => ({
    ruleId: finding.ruleId,
    ruleIndex: ruleIndex.get(finding.ruleId) ?? 0,
    level: sarifLevel(finding.severity),
    message: { text: finding.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: file },
          region: { startLine: finding.line + 1, startColumn: finding.column + 1 },
        },
      },
    ],
  }));

  const log = {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'LeakLens',
            informationUri: 'https://github.com/leaklens/leaklens',
            rules,
          },
        },
        results,
      },
    ],
  };
  return JSON.stringify(log, null, 2) + '\n';
}

/**
 * Build the human-readable text lines for findings (returned as a string so tests can
 * assert without touching stderr). Returns `null` when there are no findings (callers
 * write the "clean" message themselves).
 */
export function renderTextLines(located: readonly LocatedFinding[]): string | null {
  if (located.length === 0) {
    return null;
  }
  const lines: string[] = [];
  for (const { file, finding } of located) {
    lines.push(
      `  ${finding.severity.toUpperCase().padEnd(8)} ${finding.ruleName} — ${file}:${finding.line + 1}:${finding.column + 1}  ${finding.matchPreview}`,
    );
  }
  lines.push(`\nLeakLens: ${located.length} potential secret(s) found.`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Top-level command dispatch (pure — no I/O, returns exit code)
// ---------------------------------------------------------------------------

export interface RunScanIO {
  /** Content to scan when args.stdin is true. */
  stdinContent: string;
  /** Working directory for relative path resolution. */
  cwd: string;
}

/**
 * Core of the `scan` subcommand. Returns `{ exitCode, stdout, stderr }` so callers
 * (the real entry point and unit tests) can assert or forward to the OS.
 */
export function runScanCore(
  argv: readonly string[],
  io: RunScanIO,
): { exitCode: number; stdout: string; stderr: string } {
  let args: ScanArgs;
  try {
    args = parseScanArgs(argv);
  } catch (e) {
    return {
      exitCode: EXIT_USAGE,
      stdout: '',
      stderr: `leaklens: ${(e as Error).message}\n\n${USAGE}`,
    };
  }

  let located: LocatedFinding[];
  try {
    located = args.stdin
      ? scanStdinContent(io.stdinContent, args.stdinFilename as string)
      : scanFiles(io.cwd, args.paths);
  } catch (e) {
    return {
      exitCode: EXIT_USAGE,
      stdout: '',
      stderr: `leaklens: ${(e as Error).message}\n`,
    };
  }

  let stdout = '';
  let stderr = '';

  if (args.format === 'json') {
    stdout = renderJson(located);
  } else if (args.format === 'sarif') {
    stdout = renderSarif(located);
  } else {
    const lines = renderTextLines(located);
    if (lines === null) {
      stderr = 'LeakLens: no secrets found.\n';
    } else {
      stderr = lines + '\n';
    }
  }

  return {
    exitCode: located.length > 0 ? EXIT_FINDINGS : EXIT_CLEAN,
    stdout,
    stderr,
  };
}

/**
 * CLI entry: dispatch the subcommand. Returns an exit code.
 * Pure: callers supply `cwd` and `stdinContent`; no direct `process` usage.
 */
export function mainCore(
  argv: readonly string[],
  io: RunScanIO,
): { exitCode: number; stdout: string; stderr: string } {
  const [command, ...rest] = argv;
  if (command === '-h' || command === '--help' || command === undefined) {
    return {
      exitCode: command === undefined ? EXIT_USAGE : EXIT_CLEAN,
      stdout: USAGE,
      stderr: '',
    };
  }
  if (command === 'scan') {
    if (rest.includes('-h') || rest.includes('--help')) {
      return { exitCode: EXIT_CLEAN, stdout: USAGE, stderr: '' };
    }
    return runScanCore(rest, io);
  }
  return {
    exitCode: EXIT_USAGE,
    stdout: '',
    stderr: `leaklens: unknown command '${command}'\n\n${USAGE}`,
  };
}
