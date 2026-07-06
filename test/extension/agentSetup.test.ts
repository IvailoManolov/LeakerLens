/**
 * Unit tests for `src/extension/agentSetup.ts`.
 *
 * Strategy: import only the exported pure helpers directly under Vitest.
 * agentSetup.ts has zero vscode imports, so this works without any mocking or
 * spawning a VS Code process. All functions are deterministic string/object
 * transforms — no I/O, no clocks, no randomness.
 *
 * Coverage targets:
 *   - buildServerEntry       — stdioType true/false, path normalization
 *   - buildInstructionBlock  — CLI path embedded, tool names present
 *   - wrapBlock              — markers framing the body
 *   - mergeMcpConfig         — undefined/empty/garbage input, idempotency,
 *                              JSONC tolerance, key isolation, server preservation
 *   - mergeInstructionBlock  — undefined/missing/existing markers, idempotency
 *   - parseJsonObject        — comments, trailing commas, garbage, arrays, numbers
 *   - stripJsonComments      — line comments, block comments, string preservation
 *   - toPosix                — backslash → forward slash, mixed, already posix
 *   - Constants              — SERVER_NAME, AGENT_TARGETS, BLOCK_START, BLOCK_END
 */

import { describe, expect, it } from 'vitest';
import {
  SERVER_NAME,
  AGENT_TARGETS,
  BLOCK_START,
  BLOCK_END,
  buildServerEntry,
  buildInstructionBlock,
  wrapBlock,
  mergeMcpConfig,
  mergeInstructionBlock,
  parseJsonObject,
  stripJsonComments,
  toPosix,
  type McpServerEntry,
  type AgentTarget,
  type AgentTargetId,
} from '../../src/extension/agentSetup';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('SERVER_NAME', () => {
  it('is the string "leakerlens"', () => {
    expect(SERVER_NAME).toBe('leakerlens');
  });
});

describe('BLOCK_START / BLOCK_END', () => {
  it('BLOCK_START is the expected HTML comment marker', () => {
    expect(BLOCK_START).toBe('<!-- leakerlens:start -->');
  });

  it('BLOCK_END is the expected HTML comment marker', () => {
    expect(BLOCK_END).toBe('<!-- leakerlens:end -->');
  });

  it('BLOCK_START and BLOCK_END are different strings', () => {
    expect(BLOCK_START).not.toBe(BLOCK_END);
  });
});

describe('AGENT_TARGETS', () => {
  it('is a non-empty readonly array', () => {
    expect(Array.isArray(AGENT_TARGETS)).toBe(true);
    expect(AGENT_TARGETS.length).toBeGreaterThan(0);
  });

  it('contains the claude target with mcpServers and stdioType=false', () => {
    const claude = AGENT_TARGETS.find((t) => t.id === 'claude');
    expect(claude).toBeDefined();
    expect(claude!.topLevelKey).toBe('mcpServers');
    expect(claude!.stdioType).toBe(false);
    expect(claude!.configPath).toBe('.mcp.json');
  });

  it('contains the vscode target with servers and stdioType=true', () => {
    const vscode = AGENT_TARGETS.find((t) => t.id === 'vscode');
    expect(vscode).toBeDefined();
    expect(vscode!.topLevelKey).toBe('servers');
    expect(vscode!.stdioType).toBe(true);
    expect(vscode!.configPath).toBe('.vscode/mcp.json');
  });

  it('contains the cursor target with mcpServers and stdioType=true', () => {
    const cursor = AGENT_TARGETS.find((t) => t.id === 'cursor');
    expect(cursor).toBeDefined();
    expect(cursor!.topLevelKey).toBe('mcpServers');
    expect(cursor!.stdioType).toBe(true);
    expect(cursor!.configPath).toBe('.cursor/mcp.json');
  });

  it('every target has a non-empty label and detail', () => {
    for (const target of AGENT_TARGETS) {
      expect(typeof target.label).toBe('string');
      expect(target.label.length).toBeGreaterThan(0);
      expect(typeof target.detail).toBe('string');
      expect(target.detail.length).toBeGreaterThan(0);
    }
  });

  it('every configPath uses forward slashes (POSIX)', () => {
    for (const target of AGENT_TARGETS) {
      expect(target.configPath).not.toContain('\\');
    }
  });

  it('topLevelKey is always mcpServers or servers', () => {
    for (const target of AGENT_TARGETS) {
      expect(['mcpServers', 'servers']).toContain(target.topLevelKey);
    }
  });

  it('all three canonical ids are present', () => {
    const ids = AGENT_TARGETS.map((t) => t.id);
    const expectedIds: AgentTargetId[] = ['claude', 'vscode', 'cursor'];
    for (const id of expectedIds) {
      expect(ids).toContain(id);
    }
  });
});

// ---------------------------------------------------------------------------
// toPosix
// ---------------------------------------------------------------------------

describe('toPosix', () => {
  it('converts backslashes to forward slashes', () => {
    expect(toPosix('C:\\Users\\test\\mcp.js')).toBe('C:/Users/test/mcp.js');
  });

  it('leaves an already-posix path unchanged', () => {
    const posixPath = '/home/user/.vscode/mcp.js';
    expect(toPosix(posixPath)).toBe(posixPath);
  });

  it('handles mixed separators', () => {
    expect(toPosix('C:/Users\\test/mcp.js')).toBe('C:/Users/test/mcp.js');
  });

  it('handles an empty string', () => {
    expect(toPosix('')).toBe('');
  });

  it('handles a path with no separators at all', () => {
    expect(toPosix('mcp.js')).toBe('mcp.js');
  });

  it('handles multiple consecutive backslashes', () => {
    expect(toPosix('a\\\\b')).toBe('a//b');
  });
});

// ---------------------------------------------------------------------------
// buildServerEntry
// ---------------------------------------------------------------------------

describe('buildServerEntry', () => {
  const RUNNER = '/home/user/.vscode/globalStorage/mcp.js';
  const WIN_RUNNER = 'C:\\Users\\user\\AppData\\mcp.js';

  it('stdioType=false: omits the type field', () => {
    const entry = buildServerEntry(RUNNER, false);
    expect('type' in entry).toBe(false);
  });

  it('stdioType=false: command is "node"', () => {
    const entry = buildServerEntry(RUNNER, false);
    expect(entry.command).toBe('node');
  });

  it('stdioType=false: args contains the runner path', () => {
    const entry = buildServerEntry(RUNNER, false);
    expect(entry.args).toEqual([RUNNER]);
  });

  it('stdioType=true: includes type="stdio"', () => {
    const entry = buildServerEntry(RUNNER, true);
    expect(entry.type).toBe('stdio');
  });

  it('stdioType=true: command is "node"', () => {
    const entry = buildServerEntry(RUNNER, true);
    expect(entry.command).toBe('node');
  });

  it('stdioType=true: args contains the runner path', () => {
    const entry = buildServerEntry(RUNNER, true);
    expect(entry.args).toEqual([RUNNER]);
  });

  it('normalizes Windows backslash path to POSIX in args', () => {
    const entry = buildServerEntry(WIN_RUNNER, false);
    expect(entry.args[0]).toBe('C:/Users/user/AppData/mcp.js');
    expect(entry.args[0]).not.toContain('\\');
  });

  it('normalizes Windows backslash path to POSIX with stdioType=true', () => {
    const entry = buildServerEntry(WIN_RUNNER, true);
    expect(entry.args[0]).not.toContain('\\');
    expect(entry.type).toBe('stdio');
  });

  it('result satisfies McpServerEntry shape', () => {
    const entry: McpServerEntry = buildServerEntry(RUNNER, false);
    expect(typeof entry.command).toBe('string');
    expect(Array.isArray(entry.args)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildInstructionBlock
// ---------------------------------------------------------------------------

describe('buildInstructionBlock', () => {
  const CLI_PATH = '/home/user/.vscode/globalStorage/cli.js';
  const WIN_CLI = 'C:\\Users\\user\\globalStorage\\cli.js';

  it('contains the CLI runner path (posix-normalized)', () => {
    const block = buildInstructionBlock(CLI_PATH);
    expect(block).toContain(CLI_PATH);
  });

  it('normalizes Windows paths in the CLI runner path', () => {
    const block = buildInstructionBlock(WIN_CLI);
    expect(block).toContain('C:/Users/user/globalStorage/cli.js');
    expect(block).not.toContain('\\');
  });

  it('contains scan_text tool name', () => {
    const block = buildInstructionBlock(CLI_PATH);
    expect(block).toContain('scan_text');
  });

  it('contains scan_workspace tool name', () => {
    const block = buildInstructionBlock(CLI_PATH);
    expect(block).toContain('scan_workspace');
  });

  it('contains the leakerlens MCP server reference', () => {
    const block = buildInstructionBlock(CLI_PATH);
    expect(block).toContain('leakerlens');
  });

  it('mentions never hardcoding secrets guidance', () => {
    const block = buildInstructionBlock(CLI_PATH);
    expect(block).toContain('Never hardcode');
  });

  it('mentions .env file as the correct place for secrets', () => {
    const block = buildInstructionBlock(CLI_PATH);
    expect(block).toContain('.env');
  });

  it('is a non-empty string', () => {
    const block = buildInstructionBlock(CLI_PATH);
    expect(typeof block).toBe('string');
    expect(block.length).toBeGreaterThan(0);
  });

  it('does NOT include the BLOCK_START or BLOCK_END markers (that is wrapBlock\'s job)', () => {
    const block = buildInstructionBlock(CLI_PATH);
    expect(block).not.toContain(BLOCK_START);
    expect(block).not.toContain(BLOCK_END);
  });

  it('includes a heading about secret scanning', () => {
    const block = buildInstructionBlock(CLI_PATH);
    expect(block).toContain('Secret scanning');
  });
});

// ---------------------------------------------------------------------------
// wrapBlock
// ---------------------------------------------------------------------------

describe('wrapBlock', () => {
  const BODY = 'some instruction body\nwith two lines';

  it('starts with BLOCK_START on its own line', () => {
    const wrapped = wrapBlock(BODY);
    expect(wrapped.startsWith(BLOCK_START + '\n')).toBe(true);
  });

  it('ends with BLOCK_END', () => {
    const wrapped = wrapBlock(BODY);
    expect(wrapped.endsWith(BLOCK_END)).toBe(true);
  });

  it('contains the body between the markers', () => {
    const wrapped = wrapBlock(BODY);
    const startIdx = wrapped.indexOf(BLOCK_START);
    const endIdx = wrapped.indexOf(BLOCK_END);
    const inner = wrapped.slice(startIdx + BLOCK_START.length + 1, endIdx - 1);
    expect(inner).toBe(BODY);
  });

  it('produces exactly one BLOCK_START', () => {
    const wrapped = wrapBlock(BODY);
    const count = wrapped.split(BLOCK_START).length - 1;
    expect(count).toBe(1);
  });

  it('produces exactly one BLOCK_END', () => {
    const wrapped = wrapBlock(BODY);
    const count = wrapped.split(BLOCK_END).length - 1;
    expect(count).toBe(1);
  });

  it('BLOCK_START comes before BLOCK_END', () => {
    const wrapped = wrapBlock(BODY);
    expect(wrapped.indexOf(BLOCK_START)).toBeLessThan(wrapped.indexOf(BLOCK_END));
  });

  it('handles an empty body', () => {
    const wrapped = wrapBlock('');
    expect(wrapped).toContain(BLOCK_START);
    expect(wrapped).toContain(BLOCK_END);
  });
});

// ---------------------------------------------------------------------------
// stripJsonComments
// ---------------------------------------------------------------------------

describe('stripJsonComments', () => {
  it('removes a single-line // comment', () => {
    const input = '{ "a": 1 // comment\n}';
    const result = stripJsonComments(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it('removes multiple // comments', () => {
    const input = '{\n  // first comment\n  "a": 1, // inline\n  "b": 2\n}';
    const result = stripJsonComments(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 });
  });

  it('removes block /* */ comments', () => {
    const input = '{ /* block comment */ "a": 1 }';
    const result = stripJsonComments(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it('removes multiline block comments', () => {
    const input = '{\n  /* line 1\n     line 2 */\n  "a": 1\n}';
    const result = stripJsonComments(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it('preserves // inside a string literal', () => {
    const input = '{ "url": "https://example.com" }';
    const result = stripJsonComments(input);
    expect(result).toContain('https://example.com');
    expect(JSON.parse(result)).toEqual({ url: 'https://example.com' });
  });

  it('preserves /* */ inside a string literal', () => {
    const input = '{ "note": "a /* not a comment */ b" }';
    const result = stripJsonComments(input);
    expect(JSON.parse(result)).toEqual({ note: 'a /* not a comment */ b' });
  });

  it('handles escaped quotes inside strings without breaking the parser', () => {
    const input = '{ "msg": "say \\"hello\\"" }';
    const result = stripJsonComments(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ msg: 'say "hello"' });
  });

  it('removes trailing commas before }', () => {
    const input = '{ "a": 1, "b": 2, }';
    const result = stripJsonComments(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 });
  });

  it('removes trailing commas before ]', () => {
    const input = '{ "arr": [1, 2, 3,] }';
    const result = stripJsonComments(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ arr: [1, 2, 3] });
  });

  it('handles trailing commas with whitespace before the closing bracket', () => {
    const input = '{ "a": 1,\n  }';
    const result = stripJsonComments(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it('returns empty string unchanged (no throw)', () => {
    const result = stripJsonComments('');
    expect(result).toBe('');
  });

  it('handles input ending with a backslash inside a string (dangling escape, last char of input)', () => {
    // This exercises the `next ?? ''` fallback in BOTH stripJsonComments (line 190)
    // and stripTrailingCommas (line 226): when a backslash is the very last character
    // of the entire text and we are inside a string, `text[i + 1]` is `undefined`.
    // The parser must not throw and must return without crashing.
    const input = '"abc\\';
    expect(() => stripJsonComments(input)).not.toThrow();
    // Also test that parseJsonObject (which calls both) handles it gracefully
    expect(parseJsonObject(input)).toEqual({});
  });

  it('handles a string with // comment immediately after last property and trailing comma', () => {
    const input = `{
  "mcpServers": {
    "leakerlens": { "command": "node" }, // trailing
  }
}`;
    const result = stripJsonComments(input);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('preserves a comma that is NOT trailing (between two elements)', () => {
    const input = '{ "a": 1, "b": 2 }';
    const result = stripJsonComments(input);
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 });
  });
});

// ---------------------------------------------------------------------------
// parseJsonObject
// ---------------------------------------------------------------------------

describe('parseJsonObject', () => {
  it('returns {} for undefined input', () => {
    expect(parseJsonObject(undefined)).toEqual({});
  });

  it('returns {} for empty string', () => {
    expect(parseJsonObject('')).toEqual({});
  });

  it('returns {} for whitespace-only string', () => {
    expect(parseJsonObject('   \n\t  ')).toEqual({});
  });

  it('parses a valid JSON object', () => {
    const result = parseJsonObject('{ "a": 1, "b": "two" }');
    expect(result).toEqual({ a: 1, b: 'two' });
  });

  it('returns {} for a JSON array (not an object)', () => {
    expect(parseJsonObject('[1, 2, 3]')).toEqual({});
  });

  it('returns {} for a JSON number', () => {
    expect(parseJsonObject('42')).toEqual({});
  });

  it('returns {} for a JSON string literal', () => {
    expect(parseJsonObject('"hello"')).toEqual({});
  });

  it('returns {} for a JSON boolean', () => {
    expect(parseJsonObject('true')).toEqual({});
  });

  it('returns {} for null', () => {
    expect(parseJsonObject('null')).toEqual({});
  });

  it('returns {} for garbage text (not JSON)', () => {
    expect(parseJsonObject('not json at all')).toEqual({});
  });

  it('returns {} for partial/broken JSON', () => {
    expect(parseJsonObject('{ "a": 1')).toEqual({});
  });

  it('tolerates JSONC line comments', () => {
    const jsonc = `{
  // top-level comment
  "servers": {}
}`;
    const result = parseJsonObject(jsonc);
    expect(result).toEqual({ servers: {} });
  });

  it('tolerates JSONC block comments', () => {
    const jsonc = '{ /* block */ "key": "val" }';
    const result = parseJsonObject(jsonc);
    expect(result).toEqual({ key: 'val' });
  });

  it('tolerates trailing commas', () => {
    const jsonc = '{ "a": 1, "b": 2, }';
    const result = parseJsonObject(jsonc);
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('tolerates combined JSONC features (comments + trailing commas)', () => {
    const jsonc = `{
  // comment
  "mcpServers": {
    "other": { "command": "npx", }, // trailing comma
  },
}`;
    const result = parseJsonObject(jsonc);
    expect(result).toHaveProperty('mcpServers');
    expect((result.mcpServers as Record<string, unknown>)['other']).toBeDefined();
  });

  it('returns a plain object (not the same reference) — spread copy', () => {
    const json = '{ "a": 1 }';
    const r1 = parseJsonObject(json);
    const r2 = parseJsonObject(json);
    r1.extra = 'mutated';
    expect(r2.extra).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mergeMcpConfig — the central merge function
// ---------------------------------------------------------------------------

describe('mergeMcpConfig', () => {
  /** Canonical leakerlens entry for Claude/Cursor (no type). */
  const entry: McpServerEntry = { command: 'node', args: ['/global/mcp.js'] };

  /** Canonical leakerlens entry for VS Code (type: "stdio"). */
  const stdioEntry: McpServerEntry = { type: 'stdio', command: 'node', args: ['/global/mcp.js'] };

  // -------------------------------------------------------------------------
  // undefined / empty / whitespace input
  // -------------------------------------------------------------------------

  it('undefined input → produces a valid JSON object with the top-level key', () => {
    const output = mergeMcpConfig(undefined, 'mcpServers', entry);
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    expect(typeof parsed).toBe('object');
    expect(parsed.mcpServers).toBeDefined();
  });

  it('undefined input → mcpServers contains only leakerlens', () => {
    const output = mergeMcpConfig(undefined, 'mcpServers', entry);
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    expect(Object.keys(parsed.mcpServers)).toEqual(['leakerlens']);
  });

  it('empty string input → produces a valid JSON object', () => {
    const output = mergeMcpConfig('', 'mcpServers', entry);
    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers['leakerlens']).toBeDefined();
  });

  it('whitespace-only input → produces a valid JSON object', () => {
    const output = mergeMcpConfig('   \n  ', 'mcpServers', entry);
    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    expect(parsed.mcpServers['leakerlens']).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Existing server preserved when adding leakerlens
  // -------------------------------------------------------------------------

  it('existing server under the same key is preserved when leakerlens is added', () => {
    const existing = JSON.stringify({
      mcpServers: { other: { command: 'npx', args: ['other-tool'] } },
    });
    const output = mergeMcpConfig(existing, 'mcpServers', entry);
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    expect(parsed.mcpServers['other']).toBeDefined();
    expect(parsed.mcpServers['leakerlens']).toBeDefined();
  });

  it('existing server preserves its exact fields', () => {
    const otherServer = { command: 'npx', args: ['tool-x'], env: { DEBUG: '1' } };
    const existing = JSON.stringify({ mcpServers: { other: otherServer } });
    const output = mergeMcpConfig(existing, 'mcpServers', entry);
    const parsed = JSON.parse(output) as {
      mcpServers: { other: typeof otherServer };
    };
    expect(parsed.mcpServers.other).toEqual(otherServer);
  });

  it('multiple existing servers are all preserved', () => {
    const existing = JSON.stringify({
      mcpServers: {
        alpha: { command: 'alpha' },
        beta: { command: 'beta' },
        gamma: { command: 'gamma' },
      },
    });
    const output = mergeMcpConfig(existing, 'mcpServers', entry);
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    expect(Object.keys(parsed.mcpServers)).toContain('alpha');
    expect(Object.keys(parsed.mcpServers)).toContain('beta');
    expect(Object.keys(parsed.mcpServers)).toContain('gamma');
    expect(Object.keys(parsed.mcpServers)).toContain('leakerlens');
  });

  // -------------------------------------------------------------------------
  // Unrelated top-level keys preserved
  // -------------------------------------------------------------------------

  it('unrelated top-level keys are preserved', () => {
    const existing = JSON.stringify({
      mcpServers: {},
      inputs: [{ id: 'token', type: 'promptString' }],
      version: '1.0.0',
    });
    const output = mergeMcpConfig(existing, 'mcpServers', entry);
    const parsed = JSON.parse(output) as {
      inputs: unknown[];
      version: string;
      mcpServers: Record<string, unknown>;
    };
    expect(parsed.inputs).toBeDefined();
    expect(Array.isArray(parsed.inputs)).toBe(true);
    expect(parsed.version).toBe('1.0.0');
  });

  // -------------------------------------------------------------------------
  // Key isolation: mcpServers vs servers
  // -------------------------------------------------------------------------

  it('passing "servers" creates "servers" key, not "mcpServers"', () => {
    const output = mergeMcpConfig(undefined, 'servers', stdioEntry);
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect('servers' in parsed).toBe(true);
    expect('mcpServers' in parsed).toBe(false);
  });

  it('passing "mcpServers" creates "mcpServers" key, not "servers"', () => {
    const output = mergeMcpConfig(undefined, 'mcpServers', entry);
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect('mcpServers' in parsed).toBe(true);
    expect('servers' in parsed).toBe(false);
  });

  it('existing "mcpServers" key is untouched when writing to "servers"', () => {
    const existing = JSON.stringify({
      mcpServers: { claude_tool: { command: 'npx' } },
    });
    const output = mergeMcpConfig(existing, 'servers', stdioEntry);
    const parsed = JSON.parse(output) as {
      mcpServers: Record<string, unknown>;
      servers: Record<string, unknown>;
    };
    // Original mcpServers preserved
    expect(parsed.mcpServers['claude_tool']).toBeDefined();
    // New servers key added
    expect(parsed.servers['leakerlens']).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Idempotency: merge(merge(x)) === merge(x)
  // -------------------------------------------------------------------------

  it('idempotent on undefined input (double merge is byte-identical)', () => {
    const first = mergeMcpConfig(undefined, 'mcpServers', entry);
    const second = mergeMcpConfig(first, 'mcpServers', entry);
    expect(second).toBe(first);
  });

  it('idempotent on existing content with another server (double merge is byte-identical)', () => {
    const existing = JSON.stringify({
      mcpServers: { other: { command: 'npx' } },
    });
    const first = mergeMcpConfig(existing, 'mcpServers', entry);
    const second = mergeMcpConfig(first, 'mcpServers', entry);
    expect(second).toBe(first);
  });

  it('idempotent with "servers" key and stdioType entry', () => {
    const first = mergeMcpConfig(undefined, 'servers', stdioEntry);
    const second = mergeMcpConfig(first, 'servers', stdioEntry);
    expect(second).toBe(first);
  });

  it('triple merge is also byte-identical', () => {
    const first = mergeMcpConfig(undefined, 'mcpServers', entry);
    const second = mergeMcpConfig(first, 'mcpServers', entry);
    const third = mergeMcpConfig(second, 'mcpServers', entry);
    expect(third).toBe(first);
  });

  // -------------------------------------------------------------------------
  // JSONC tolerance
  // -------------------------------------------------------------------------

  it('tolerates // line comments in input and merges correctly', () => {
    const jsonc = `{
  // This is a comment
  "mcpServers": {
    "other": { "command": "npx" }
  }
}`;
    const output = mergeMcpConfig(jsonc, 'mcpServers', entry);
    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    expect(parsed.mcpServers['other']).toBeDefined();
    expect(parsed.mcpServers['leakerlens']).toBeDefined();
  });

  it('tolerates /* */ block comments in input', () => {
    const jsonc = '{ /* block comment */ "mcpServers": {} }';
    const output = mergeMcpConfig(jsonc, 'mcpServers', entry);
    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    expect(parsed.mcpServers['leakerlens']).toBeDefined();
  });

  it('tolerates trailing commas in input', () => {
    const jsonc = `{
  "mcpServers": {
    "other": { "command": "npx", },
  },
}`;
    const output = mergeMcpConfig(jsonc, 'mcpServers', entry);
    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    expect(parsed.mcpServers['other']).toBeDefined();
    expect(parsed.mcpServers['leakerlens']).toBeDefined();
  });

  it('JSONC output is strict JSON (no comments, no trailing commas)', () => {
    const jsonc = `{
  // comment
  "mcpServers": { "other": { "command": "x", }, }
}`;
    const output = mergeMcpConfig(jsonc, 'mcpServers', entry);
    // Output must parse cleanly as strict JSON
    expect(() => JSON.parse(output)).not.toThrow();
    // Output must not contain comment markers
    expect(output).not.toContain('//');
    expect(output).not.toContain('/*');
  });

  // -------------------------------------------------------------------------
  // Garbage / non-object JSON recovery
  // -------------------------------------------------------------------------

  it('garbage input ("not json") recovers to a fresh object', () => {
    const output = mergeMcpConfig('not json', 'mcpServers', entry);
    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    expect(parsed.mcpServers['leakerlens']).toBeDefined();
  });

  it('JSON array input "[]" recovers to a fresh object', () => {
    const output = mergeMcpConfig('[]', 'mcpServers', entry);
    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    expect(parsed.mcpServers['leakerlens']).toBeDefined();
  });

  it('JSON number input "42" recovers to a fresh object', () => {
    const output = mergeMcpConfig('42', 'mcpServers', entry);
    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    expect(parsed.mcpServers['leakerlens']).toBeDefined();
  });

  it('JSON string literal recovers to a fresh object', () => {
    const output = mergeMcpConfig('"a string"', 'mcpServers', entry);
    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    expect(parsed.mcpServers['leakerlens']).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Output format
  // -------------------------------------------------------------------------

  it('output is pretty-printed with 2-space indentation', () => {
    const output = mergeMcpConfig(undefined, 'mcpServers', entry);
    // JSON.stringify with 2-space indent produces "  " at the second level
    expect(output).toContain('  ');
  });

  it('output ends with a trailing newline', () => {
    const output = mergeMcpConfig(undefined, 'mcpServers', entry);
    expect(output.endsWith('\n')).toBe(true);
  });

  it('top-level key maps the server entry under SERVER_NAME ("leakerlens")', () => {
    const output = mergeMcpConfig(undefined, 'mcpServers', entry);
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    const serverKey = Object.keys(parsed.mcpServers)[0];
    expect(serverKey).toBe(SERVER_NAME);
  });

  // -------------------------------------------------------------------------
  // Non-object value under top-level key is replaced by a fresh map
  // -------------------------------------------------------------------------

  it('top-level key with a non-object value (e.g. array) is replaced by a fresh servers map', () => {
    const existing = JSON.stringify({ mcpServers: [1, 2, 3] });
    const output = mergeMcpConfig(existing, 'mcpServers', entry);
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    // should be an object now, not an array
    expect(Array.isArray(parsed.mcpServers)).toBe(false);
    expect(parsed.mcpServers['leakerlens']).toBeDefined();
  });

  it('top-level key with null is replaced by a fresh servers map', () => {
    const existing = JSON.stringify({ mcpServers: null });
    const output = mergeMcpConfig(existing, 'mcpServers', entry);
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    expect(parsed.mcpServers['leakerlens']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// mergeInstructionBlock
// ---------------------------------------------------------------------------

describe('mergeInstructionBlock', () => {
  const CLI_PATH = '/home/user/globalStorage/cli.js';
  const BODY = buildInstructionBlock(CLI_PATH);
  const BLOCK = wrapBlock(BODY);

  // -------------------------------------------------------------------------
  // undefined / empty / missing input
  // -------------------------------------------------------------------------

  it('undefined input → returns just the wrapped block with a trailing newline', () => {
    const output = mergeInstructionBlock(undefined, BLOCK);
    expect(output).toContain(BLOCK_START);
    expect(output).toContain(BLOCK_END);
    expect(output.endsWith('\n')).toBe(true);
  });

  it('undefined input → output starts with BLOCK_START', () => {
    const output = mergeInstructionBlock(undefined, BLOCK);
    expect(output.startsWith(BLOCK_START)).toBe(true);
  });

  it('empty string input → returns just the wrapped block', () => {
    const output = mergeInstructionBlock('', BLOCK);
    expect(output).toContain(BLOCK_START);
    expect(output).toContain(BLOCK_END);
  });

  it('whitespace-only input → treated as empty, returns just the wrapped block', () => {
    const output = mergeInstructionBlock('   \n  ', BLOCK);
    expect(output).toContain(BLOCK_START);
    expect(output).toContain(BLOCK_END);
    // The prior content should not add noise
    expect(output.trim().startsWith(BLOCK_START)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Existing content with NO markers → block appended
  // -------------------------------------------------------------------------

  it('existing content without markers → block is appended', () => {
    const existing = '# My AGENTS.md\n\nSome existing instructions here.';
    const output = mergeInstructionBlock(existing, BLOCK);
    expect(output).toContain(BLOCK_START);
    expect(output).toContain(BLOCK_END);
    // Original content is preserved (byte-exact)
    expect(output).toContain('# My AGENTS.md');
    expect(output).toContain('Some existing instructions here.');
  });

  it('existing content without markers → prior content comes BEFORE the block', () => {
    const existing = '# Header';
    const output = mergeInstructionBlock(existing, BLOCK);
    const headerIdx = output.indexOf('# Header');
    const blockIdx = output.indexOf(BLOCK_START);
    expect(headerIdx).toBeLessThan(blockIdx);
  });

  it('existing content without markers → exactly one blank line separates prior content and block', () => {
    const existing = '# Header\n\nSome text.';
    const output = mergeInstructionBlock(existing, BLOCK);
    // After the base content, there should be \n\n then BLOCK_START
    const baseEnd = output.indexOf(BLOCK_START) - 2; // 2 newlines before block
    const separator = output.slice(output.indexOf('Some text.') + 'Some text.'.length, output.indexOf(BLOCK_START));
    expect(separator).toBe('\n\n');
  });

  it('existing content without markers — trailing whitespace of prior content is stripped before appending', () => {
    const existing = '# Header\n\nText.   \n\n  ';
    const output = mergeInstructionBlock(existing, BLOCK);
    // Should not have excessive blank lines between content and block
    expect(output).not.toContain('Text.   \n');
    // Block should still appear
    expect(output).toContain(BLOCK_START);
  });

  // -------------------------------------------------------------------------
  // Existing content WITH markers → block replaced in place
  // -------------------------------------------------------------------------

  it('existing content with markers → block is replaced in place', () => {
    const before = '# Header\n\nSome text before.\n\n';
    const oldBody = 'OLD BODY CONTENT';
    const oldBlock = wrapBlock(oldBody);
    const after = '\n\nSome text after.';
    const existing = before + oldBlock + after;

    const output = mergeInstructionBlock(existing, BLOCK);

    // Old body must be gone
    expect(output).not.toContain(oldBody);
    // New block must be present
    expect(output).toContain(BLOCK);
    // Surrounding content preserved
    expect(output).toContain('Some text before.');
    expect(output).toContain('Some text after.');
  });

  it('existing content with markers → content before marker is byte-preserved', () => {
    const before = '# My Header\n\n> some blockquote\n\n';
    const existing = before + wrapBlock('old') + '\n\nafter content';
    const output = mergeInstructionBlock(existing, BLOCK);
    expect(output.startsWith(before)).toBe(true);
  });

  it('existing content with markers → content after marker is byte-preserved', () => {
    const after = '\n\n## Footer section\n';
    const existing = '# Header\n\n' + wrapBlock('old') + after;
    const output = mergeInstructionBlock(existing, BLOCK);
    expect(output.endsWith(after)).toBe(true);
  });

  it('existing content with markers → markers appear exactly once in output', () => {
    const existing = '# Header\n\n' + wrapBlock('old body') + '\n\nfooter';
    const output = mergeInstructionBlock(existing, BLOCK);
    expect(output.split(BLOCK_START).length - 1).toBe(1);
    expect(output.split(BLOCK_END).length - 1).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Idempotency
  // -------------------------------------------------------------------------

  it('idempotent on undefined input (double merge is byte-identical)', () => {
    const first = mergeInstructionBlock(undefined, BLOCK);
    const second = mergeInstructionBlock(first, BLOCK);
    expect(second).toBe(first);
  });

  it('idempotent on existing content with no prior markers (double merge is byte-identical)', () => {
    const existing = '# Header\n\nSome content.';
    const first = mergeInstructionBlock(existing, BLOCK);
    const second = mergeInstructionBlock(first, BLOCK);
    expect(second).toBe(first);
  });

  it('idempotent when block already present (triple merge is byte-identical)', () => {
    const first = mergeInstructionBlock(undefined, BLOCK);
    const second = mergeInstructionBlock(first, BLOCK);
    const third = mergeInstructionBlock(second, BLOCK);
    expect(third).toBe(first);
  });

  it('never more than one BLOCK_START / BLOCK_END pair after repeated merges', () => {
    const existing = '# Existing doc\n\nLots of content here.';
    let doc = existing;
    for (let i = 0; i < 5; i++) {
      doc = mergeInstructionBlock(doc, BLOCK);
    }
    expect(doc.split(BLOCK_START).length - 1).toBe(1);
    expect(doc.split(BLOCK_END).length - 1).toBe(1);
  });

  it('idempotent with different existing content (content is replaced, not duplicated)', () => {
    const existingDoc = '# AGENTS\n\nSome preamble.';
    const firstMerge = mergeInstructionBlock(existingDoc, BLOCK);
    // Now merge with a "new" block (same block, simulating re-run)
    const secondMerge = mergeInstructionBlock(firstMerge, BLOCK);
    expect(secondMerge).toBe(firstMerge);
    // Only one copy of the block body
    const bodySnippet = 'Secret scanning';
    const count = secondMerge.split(bodySnippet).length - 1;
    // The block body contains "Secret scanning" once
    expect(count).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it('block with no surrounding content produces output that contains only the block', () => {
    const output = mergeInstructionBlock(undefined, BLOCK);
    const stripped = output.trim();
    expect(stripped.startsWith(BLOCK_START)).toBe(true);
    expect(stripped.endsWith(BLOCK_END)).toBe(true);
  });

  it('a document that is only the block (no surrounding content) is idempotent', () => {
    const docWithOnlyBlock = BLOCK + '\n';
    const merged = mergeInstructionBlock(docWithOnlyBlock, BLOCK);
    expect(merged).toBe(docWithOnlyBlock);
  });

  it('markers must be well-ordered: if start > end, the block is appended instead of replaced', () => {
    // Corrupt marker ordering: end before start (degenerate input)
    const corrupted = BLOCK_END + '\n\nsome content\n\n' + BLOCK_START;
    const output = mergeInstructionBlock(corrupted, BLOCK);
    // Should append the block (the markers are out of order, so the path falls through to append)
    expect(output).toContain(BLOCK);
  });
});

// ---------------------------------------------------------------------------
// Integration: round-trip buildInstructionBlock → wrapBlock → mergeInstructionBlock
// ---------------------------------------------------------------------------

describe('round-trip: buildInstructionBlock → wrapBlock → mergeInstructionBlock', () => {
  it('a fresh AGENTS.md gets the block and is idempotent on re-run', () => {
    const cliPath = '/storage/cli.js';
    const body = buildInstructionBlock(cliPath);
    const block = wrapBlock(body);

    const first = mergeInstructionBlock(undefined, block);
    const second = mergeInstructionBlock(first, block);

    expect(second).toBe(first);
    expect(first).toContain('scan_text');
    expect(first).toContain('scan_workspace');
    expect(first).toContain(cliPath);
  });

  it('updating the CLI path produces correct in-place replacement', () => {
    const oldCli = '/old/cli.js';
    const newCli = '/new/cli.js';

    const firstBlock = wrapBlock(buildInstructionBlock(oldCli));
    const doc = mergeInstructionBlock(undefined, firstBlock);

    const secondBlock = wrapBlock(buildInstructionBlock(newCli));
    const updated = mergeInstructionBlock(doc, secondBlock);

    expect(updated).toContain(newCli);
    expect(updated).not.toContain(oldCli);
    // Exactly one marker pair
    expect(updated.split(BLOCK_START).length - 1).toBe(1);
    expect(updated.split(BLOCK_END).length - 1).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Integration: round-trip buildServerEntry → mergeMcpConfig
// ---------------------------------------------------------------------------

describe('round-trip: buildServerEntry → mergeMcpConfig', () => {
  it('Claude target: correct key and no type field in entry', () => {
    const claudeTarget = AGENT_TARGETS.find((t) => t.id === 'claude')!;
    const entry = buildServerEntry('/storage/mcp.js', claudeTarget.stdioType);
    const output = mergeMcpConfig(undefined, claudeTarget.topLevelKey, entry);
    const parsed = JSON.parse(output) as Record<string, Record<string, McpServerEntry>>;
    const leakerlens = parsed[claudeTarget.topLevelKey]['leakerlens'];
    expect(leakerlens.command).toBe('node');
    expect('type' in leakerlens).toBe(false);
    expect(leakerlens.args[0]).toBe('/storage/mcp.js');
  });

  it('VS Code target: correct key and type="stdio" in entry', () => {
    const vscodeTarget = AGENT_TARGETS.find((t) => t.id === 'vscode')!;
    const entry = buildServerEntry('/storage/mcp.js', vscodeTarget.stdioType);
    const output = mergeMcpConfig(undefined, vscodeTarget.topLevelKey, entry);
    const parsed = JSON.parse(output) as Record<string, Record<string, McpServerEntry>>;
    const leakerlens = parsed[vscodeTarget.topLevelKey]['leakerlens'];
    expect(leakerlens.type).toBe('stdio');
    expect('servers' in parsed).toBe(true);
    expect('mcpServers' in parsed).toBe(false);
  });

  it('Cursor target: correct key and type="stdio" in entry', () => {
    const cursorTarget = AGENT_TARGETS.find((t) => t.id === 'cursor')!;
    const entry = buildServerEntry('/storage/mcp.js', cursorTarget.stdioType);
    const output = mergeMcpConfig(undefined, cursorTarget.topLevelKey, entry);
    const parsed = JSON.parse(output) as Record<string, Record<string, McpServerEntry>>;
    const leakerlens = parsed[cursorTarget.topLevelKey]['leakerlens'];
    expect(leakerlens.type).toBe('stdio');
    expect('mcpServers' in parsed).toBe(true);
  });

  it('idempotent across all three agent targets', () => {
    for (const target of AGENT_TARGETS) {
      const entry = buildServerEntry('/storage/mcp.js', target.stdioType);
      const first = mergeMcpConfig(undefined, target.topLevelKey, entry);
      const second = mergeMcpConfig(first, target.topLevelKey, entry);
      expect(second).toBe(first);
    }
  });
});
