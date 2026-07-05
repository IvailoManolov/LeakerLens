/**
 * Pure, `vscode`-free helpers for the `LeakLens: Set up agent guardrails` command.
 *
 * This module mirrors how {@link ../cli/core} separates pure logic from the process shell:
 * every function here is a deterministic string/object transform that takes the *existing*
 * file contents and returns the *new* contents, so the merge behaviour can be unit-tested
 * under Vitest without spawning VS Code or touching the filesystem. All file I/O, QuickPick,
 * and message-box wiring lives in the thin command shell (`commands.ts`).
 *
 * Design rule: every merge is **idempotent** — feeding the output of a merge back in as the
 * input yields byte-identical output, so re-running the command never duplicates a server
 * entry or an instruction block.
 */

// ---------------------------------------------------------------------------
// MCP server entry shapes
// ---------------------------------------------------------------------------

/**
 * A single MCP server definition as written under the per-tool top-level key. Claude Code and
 * Cursor use the bare `{ command, args }` form; VS Code / Copilot additionally require
 * `type: "stdio"`. Modelled as an open record so we never strip fields a host may add.
 */
export interface McpServerEntry {
  readonly command: string;
  readonly args: readonly string[];
  readonly type?: string;
  readonly [extra: string]: unknown;
}

/** The agent targets this command can configure. */
export type AgentTargetId = 'claude' | 'vscode' | 'cursor';

/**
 * Static description of one agent target: which file to merge into, which top-level key the
 * servers live under, and whether the server entry carries `type: "stdio"`.
 */
export interface AgentTarget {
  readonly id: AgentTargetId;
  /** Human label shown in the QuickPick. */
  readonly label: string;
  /** One-line description shown in the QuickPick. */
  readonly detail: string;
  /** Workspace-relative path of the config file to write/merge. POSIX separators. */
  readonly configPath: string;
  /** Top-level JSON key the server map lives under (`mcpServers` or `servers`). */
  readonly topLevelKey: 'mcpServers' | 'servers';
  /** Whether the server entry includes `type: "stdio"` (VS Code / Copilot requires it). */
  readonly stdioType: boolean;
}

/** The server map is always keyed by server name (we only ever write `leaklens`). */
export const SERVER_NAME = 'leaklens';

/** All supported agent targets, in QuickPick display order. */
export const AGENT_TARGETS: readonly AgentTarget[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    detail: 'Writes .mcp.json (mcpServers)',
    configPath: '.mcp.json',
    topLevelKey: 'mcpServers',
    stdioType: false,
  },
  {
    id: 'vscode',
    label: 'VS Code / Copilot',
    detail: 'Writes .vscode/mcp.json (servers)',
    configPath: '.vscode/mcp.json',
    topLevelKey: 'servers',
    stdioType: true,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    detail: 'Writes .cursor/mcp.json (mcpServers)',
    configPath: '.cursor/mcp.json',
    topLevelKey: 'mcpServers',
    stdioType: true,
  },
];

// ---------------------------------------------------------------------------
// Pure builders
// ---------------------------------------------------------------------------

/**
 * Build the `leaklens` MCP server entry that points at the stable `mcp.js` runner.
 *
 * @param runnerPath Absolute path to `mcp.js` in globalStorage. Normalized to forward slashes
 *   so the generated JSON is identical across platforms (`JSON.stringify` handles escaping).
 * @param stdioType When true, includes `type: "stdio"` (VS Code / Copilot form).
 */
export function buildServerEntry(runnerPath: string, stdioType: boolean): McpServerEntry {
  const posixPath = toPosix(runnerPath);
  return stdioType
    ? { type: 'stdio', command: 'node', args: [posixPath] }
    : { command: 'node', args: [posixPath] };
}

/** Normalize a filesystem path to forward slashes (Windows backslashes → `/`). */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// MCP config merge
// ---------------------------------------------------------------------------

/**
 * Merge the `leaklens` server entry into an existing MCP config document, preserving every
 * other server and every unrelated top-level key. Tolerant of a missing/empty/garbage input
 * (treated as `{}`). Returns pretty-printed (2-space) JSON with a trailing newline.
 *
 * Idempotent: re-merging an already-merged document reproduces it byte-for-byte (the entry is
 * overwritten with the same value).
 *
 * @param existingJsonText Current file contents, or `''` / `undefined` if the file is absent.
 * @param topLevelKey The key the server map lives under (`mcpServers` or `servers`).
 * @param serverEntry The `leaklens` entry to install.
 */
export function mergeMcpConfig(
  existingJsonText: string | undefined,
  topLevelKey: string,
  serverEntry: McpServerEntry,
): string {
  const root = parseJsonObject(existingJsonText);

  const existingServers = root[topLevelKey];
  const servers: Record<string, unknown> =
    isPlainObject(existingServers) ? { ...existingServers } : {};
  servers[SERVER_NAME] = serverEntry;
  root[topLevelKey] = servers;

  return JSON.stringify(root, null, 2) + '\n';
}

/**
 * Parse text as a JSON object, tolerating comments (`//` and block), trailing commas, an empty
 * string, or invalid JSON — any of which yields a fresh `{}`. Used so a hand-edited JSONC
 * config (common for VS Code) never throws; we re-serialize as strict JSON on write.
 */
export function parseJsonObject(text: string | undefined): Record<string, unknown> {
  if (text === undefined) {
    return {};
  }
  const stripped = stripJsonComments(text).trim();
  if (stripped === '') {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(stripped);
    return isPlainObject(parsed) ? { ...parsed } : {};
  } catch {
    return {};
  }
}

/**
 * Remove `//` line comments, `/* *\/` block comments, and trailing commas from JSONC text so
 * it parses as strict JSON. String literals (including escaped quotes) are preserved verbatim,
 * so a `//` or comma inside a value is never touched.
 */
export function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (ch === '\n') {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        // Copy the escaped char verbatim so `\"` doesn't end the string.
        out += next ?? '';
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLine = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      i++;
      continue;
    }
    out += ch;
  }
  return stripTrailingCommas(out);
}

/** Remove commas that immediately precede a `}` or `]` (allowed in JSONC, not in JSON). */
function stripTrailingCommas(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += text[i + 1] ?? '';
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ',') {
      // Look ahead past whitespace for a closing bracket.
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) {
        j++;
      }
      if (text[j] === '}' || text[j] === ']') {
        continue; // drop the comma
      }
    }
    out += ch;
  }
  return out;
}

/** True for a non-null, non-array object literal. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Instruction block (AGENTS.md / CLAUDE.md)
// ---------------------------------------------------------------------------

/** HTML-comment markers delimiting the managed instruction block. */
export const BLOCK_START = '<!-- leaklens:start -->';
export const BLOCK_END = '<!-- leaklens:end -->';

/**
 * Build the agent-facing instruction body (between, not including, the markers) given the
 * stable CLI runner path. Concise by design — it is injected into a shared `AGENTS.md` that
 * other tools also read.
 *
 * @param cliRunnerPath Absolute path to `cli.js` in globalStorage. Forward-slash normalized.
 */
export function buildInstructionBlock(cliRunnerPath: string): string {
  const cli = toPosix(cliRunnerPath);
  return [
    '## Secret scanning — LeakLens',
    '',
    'Before writing code that may contain credentials, and before finishing a task, check for hardcoded secrets:',
    '',
    '- **MCP (preferred):** call `leaklens.scan_text` on file contents before writing them; use `leaklens.scan_workspace` to audit. The `leaklens` MCP server is configured for this project.',
    `- **CLI:** run \`node "${cli}" scan\`. A non-zero exit code means a secret was found. Use \`--json\` for machine-readable output.`,
    '- Never hardcode API keys, tokens, or private keys. Put secrets in a gitignored `.env` file and read them at runtime.',
    '- LeakLens only ever reports a masked preview + fingerprint — it never echoes the raw secret.',
  ].join('\n');
}

/**
 * Wrap an instruction body in the managed markers (start marker, body, end marker), each on
 * its own line. This is the canonical on-disk form of the managed region.
 */
export function wrapBlock(body: string): string {
  return `${BLOCK_START}\n${body}\n${BLOCK_END}`;
}

/**
 * Merge the managed instruction block into a Markdown document.
 *
 * - If both markers are present (and well-ordered), replace the region between them in place,
 *   preserving everything before the start marker and after the end marker.
 * - Otherwise, append the block to the end (preceded by a blank-line separator if the file is
 *   non-empty). A missing/empty file becomes just the block.
 *
 * Idempotent: re-merging reproduces the document (the managed region is replaced with the same
 * content; nothing is appended a second time).
 *
 * @param existingMarkdown Current file contents, or `''` / `undefined` if absent.
 * @param block The wrapped block to install (use {@link wrapBlock}).
 */
export function mergeInstructionBlock(
  existingMarkdown: string | undefined,
  block: string,
): string {
  const text = existingMarkdown ?? '';
  const startIdx = text.indexOf(BLOCK_START);
  const endIdx = text.indexOf(BLOCK_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = text.slice(0, startIdx);
    const after = text.slice(endIdx + BLOCK_END.length);
    return before + block + after;
  }

  if (text.trim() === '') {
    return block + '\n';
  }
  // Append with exactly one blank line between prior content and the block.
  const base = text.replace(/\s*$/, '');
  return `${base}\n\n${block}\n`;
}
