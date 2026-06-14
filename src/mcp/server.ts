/**
 * Local stdio MCP server for LeakLens. Lets AI coding agents (Claude Code, Cursor,
 * Windsurf, …) call the detection engine directly — `scan_text` before writing a snippet
 * to disk, `scan_file` for one file, `scan_workspace` for a sweep — instead of shelling out
 * and parsing CLI text.
 *
 * Like the headless CLI ({@link ../cli/core}) and the git hook runner, this reuses the *pure*
 * detection engine verbatim: no detection logic, file-walking, gitignore handling, env-file
 * policy, or JSON shaping is reimplemented here — every result is produced by the same
 * `scanFiles`/`scanStdinContent` + `toJsonFinding`/`renderJson` building blocks the CLI uses,
 * so MCP output is byte-for-byte consistent with `leaklens scan --json`. It never imports
 * `vscode` and makes no network calls.
 *
 * Privacy invariant: only `matchPreview` + `fingerprint` ever cross the wire (see
 * {@link JsonFinding}). The raw matched secret is NEVER echoed — not even in `scan_text`,
 * where the agent supplied the text itself.
 *
 * Bundled standalone to `dist/mcp.js`; the SDK is intentionally kept out of the hot-path
 * `dist/cli.js`, which only `require`s this file lazily for the `mcp` subcommand.
 */
import { readFileSync } from 'fs';
import { resolve, sep } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { scanText } from '../engine';
import {
  scanFiles,
  scanStdinContent,
  toJsonFinding,
  compareLocated,
  type JsonFinding,
  type LocatedFinding,
} from '../cli/core';
import type { Severity } from '../engine';

/**
 * Server version, inlined at build time by esbuild's `define` from `package.json` so the
 * MCP identity tracks the single source of truth without a duplicated literal or a runtime
 * filesystem read. Falls back to `0.0.0` when run un-bundled (e.g. ts-node in tests).
 */
declare const __LEAKLENS_VERSION__: string | undefined;
const PKG_VERSION: string =
  typeof __LEAKLENS_VERSION__ === 'string' ? __LEAKLENS_VERSION__ : '0.0.0';

// ---------------------------------------------------------------------------
// Result shape (identical to the CLI's `--json` payload)
// ---------------------------------------------------------------------------

/** Per-severity counts, mirroring the CLI summary. */
export interface SeveritySummary {
  readonly total: number;
  readonly bySeverity: Record<Severity, number>;
}

/**
 * The structured object returned to the agent as `structuredContent`. Identical in shape to
 * the CLI's `--json` output (`{ findings, summary }`) so downstream tooling can treat MCP
 * and CLI results interchangeably. Carries no raw secret — only masked previews.
 */
export interface ScanResult {
  readonly findings: readonly JsonFinding[];
  readonly summary: SeveritySummary;
}

/**
 * A full tool result: the structured object plus a short, agent-legible human summary. The
 * MCP layer maps this onto `{ content, structuredContent, isError }`.
 */
export interface ToolResult {
  readonly structured: ScanResult;
  readonly summaryText: string;
}

// ---------------------------------------------------------------------------
// Shared shaping — reuse the CLI's deterministic sort + JSON mapping
// ---------------------------------------------------------------------------

/**
 * Turn located findings into the stable `{ findings, summary }` object plus a one-glance
 * text summary. Sorting matches {@link compareLocated} (the CLI order) so results are
 * deterministic and identical to `leaklens scan --json`.
 */
export function buildResult(located: readonly LocatedFinding[]): ToolResult {
  const sorted = [...located].sort(compareLocated);
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const findings = sorted.map((lf) => {
    bySeverity[lf.finding.severity] += 1;
    return toJsonFinding(lf);
  });
  const structured: ScanResult = {
    findings,
    summary: { total: findings.length, bySeverity },
  };
  return { structured, summaryText: summarize(structured) };
}

/**
 * Build the short human summary an agent reads at a glance: a headline count + severity
 * breakdown, then one bulleted `file:line — ruleName  preview` line per finding (masked
 * previews only — never the raw secret).
 */
export function summarize(result: ScanResult): string {
  const { findings, summary } = result;
  if (findings.length === 0) {
    return 'No secrets found.';
  }
  const order: readonly Severity[] = ['critical', 'high', 'medium', 'low'];
  const breakdown = order
    .filter((s) => summary.bySeverity[s] > 0)
    .map((s) => `${summary.bySeverity[s]} ${s}`)
    .join(', ');
  const noun = summary.total === 1 ? 'secret' : 'secrets';
  const lines = findings.map(
    (f) => `  - ${f.file}:${f.line} — ${f.ruleName}  ${f.matchPreview}`,
  );
  return `${summary.total} ${noun} found: ${breakdown}\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Tool handlers (pure-ish, exported, unit-testable without a transport)
// ---------------------------------------------------------------------------

/**
 * `scan_text` handler. Scans an in-memory snippet attributed to an optional filename
 * (so filename-context rules like `.env` gating apply). No filesystem access.
 */
export function handleScanText(input: { text: string; filename?: string }): ToolResult {
  const filename = input.filename && input.filename.length > 0 ? input.filename : 'snippet.txt';
  // Reuse the CLI's stdin scanner so a snippet scan is byte-for-byte identical to
  // `leaklens scan --stdin --filename <name>`.
  return buildResult(scanStdinContent(input.text, filename));
}

/**
 * `scan_file` handler. Reads one file from disk and scans it. Throws on an unreadable
 * path so the MCP layer can surface a clean `isError` tool result without crashing.
 */
export function handleScanFile(input: { path: string }, cwd: string): ToolResult {
  const abs = resolve(cwd, input.path);
  let text: string;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (e) {
    throw new Error(`cannot read file '${input.path}': ${(e as Error).message}`);
  }
  const relPosix = abs.split(sep).join('/');
  const located = scanText(text, { filename: abs }).map((finding) => ({
    file: relPosix,
    finding,
  }));
  return buildResult(located);
}

/**
 * `scan_workspace` handler. Walks the given paths (or `root`, or `cwd`), respecting
 * `.gitignore` + EXCLUDED_DIRS + the env-file policy — exactly like `leaklens scan` —
 * via the CLI's {@link scanFiles}.
 */
export function handleScanWorkspace(
  input: { paths?: readonly string[]; root?: string },
  cwd: string,
): ToolResult {
  const base = input.root && input.root.length > 0 ? resolve(cwd, input.root) : cwd;
  const paths = input.paths ?? [];
  return buildResult(scanFiles(base, paths));
}

// ---------------------------------------------------------------------------
// MCP wiring — map handlers onto tools (no transport yet, so this is testable too)
// ---------------------------------------------------------------------------

/** Shape an MCP `CallToolResult` from a {@link ToolResult}. */
function ok(result: ToolResult): {
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
} {
  return {
    content: [{ type: 'text', text: result.summaryText }],
    // reason: SDK types `structuredContent` as Record<string, unknown>; ScanResult is a
    // concrete readonly object, so a single localized cast keeps the rest fully typed.
    structuredContent: result.structured as unknown as Record<string, unknown>,
  };
}

/** Shape an MCP error tool result (never throws out of a handler → server stays alive). */
function fail(message: string): {
  content: { type: 'text'; text: string }[];
  isError: true;
} {
  return { content: [{ type: 'text', text: `LeakLens: ${message}` }], isError: true };
}

/**
 * Build and configure the MCP server with all three tools registered. Pure construction —
 * no transport is attached, so tests can build a server (or call the handlers directly)
 * without touching stdio. `cwd` is injected for deterministic, testable path resolution.
 */
export function createServer(cwd: string = process.cwd()): McpServer {
  const server = new McpServer({ name: 'leaklens', version: PKG_VERSION });

  server.registerTool(
    'scan_text',
    {
      title: 'Scan text for secrets',
      description:
        'Scan a snippet of code or text for hardcoded secrets (API keys, tokens, ' +
        'private keys, high-entropy credentials) BEFORE writing it to disk. Returns ' +
        'masked findings — never the raw secret. Pass an optional `filename` so ' +
        'filename-aware rules (e.g. .env files) apply.',
      inputSchema: {
        text: z.string().describe('The code or text to scan.'),
        filename: z
          .string()
          .optional()
          .describe('Optional filename to attribute the text to, for filename-aware rules.'),
      },
    },
    (args) => {
      try {
        return ok(handleScanText(args));
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    'scan_file',
    {
      title: 'Scan a file for secrets',
      description:
        'Scan a single file on disk for secrets and return the problems found. Returns ' +
        'masked findings — never the raw secret.',
      inputSchema: {
        path: z.string().describe('Path to the file to scan (absolute, or relative to cwd).'),
      },
    },
    (args) => {
      try {
        return ok(handleScanFile(args, cwd));
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    'scan_workspace',
    {
      title: 'Scan the workspace for secrets',
      description:
        'Scan the workspace (or given paths) for secrets and return all problems found. ' +
        'Respects .gitignore and the same exclusions as `leaklens scan`. Returns masked ' +
        'findings — never the raw secret.',
      inputSchema: {
        paths: z
          .array(z.string())
          .optional()
          .describe('Files or directories to scan. Defaults to the whole workspace root.'),
        root: z
          .string()
          .optional()
          .describe('Workspace root for path resolution. Defaults to the process cwd.'),
      },
    },
    (args) => {
      try {
        return ok(handleScanWorkspace(args, cwd));
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// Transport shell — the only impure entry point (mirrors cli/index.ts)
// ---------------------------------------------------------------------------

/**
 * Start the server on a stdio transport and block until the client disconnects. This is the
 * thin process shell: it owns the transport + `connect()`; all logic lives above and is
 * tested without it. The MCP protocol speaks JSON-RPC over stdout, so we must NEVER write
 * to stdout ourselves — diagnostics go to stderr.
 */
export async function start(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('LeakLens MCP server listening on stdio.\n');
}
