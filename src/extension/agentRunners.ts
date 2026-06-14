/**
 * Path-stable runner provisioning for the MCP server + CLI.
 *
 * VS Code installs each extension version into a NEW versioned folder, so any absolute path
 * into `extensionUri/dist` (e.g. baked into a generated `.mcp.json`) breaks on the next update.
 * To give generated configs a path that survives updates, we copy both `dist/mcp.js` and
 * `dist/cli.js` into `context.globalStorageUri`, which is STABLE across versions. The two files
 * are kept as SIBLINGS because the CLI's `mcp` subcommand lazily `require`s `./mcp.js` next to
 * itself (see `src/cli/index.ts`).
 *
 * Call {@link ensureAgentRunners} on activation (so updates refresh the copies) and again,
 * defensively, at command time. The thin `vscode` glue lives here; the generated config text
 * is produced by the pure helpers in {@link ./agentSetup}.
 */
import * as vscode from 'vscode';

/** Absolute paths to the provisioned runner siblings in globalStorage. */
export interface AgentRunnerPaths {
  /** Absolute path to the copied `mcp.js`. */
  readonly mcpPath: string;
  /** Absolute path to the copied `cli.js`. */
  readonly cliPath: string;
}

/**
 * Copy `dist/mcp.js` and `dist/cli.js` from the (versioned) extension folder into the (stable)
 * globalStorage folder and return their absolute paths. Overwrites on every call so an extension
 * update refreshes the bundles. The destination directory is created first.
 *
 * Resolves with the destination paths even on a refresh (the copy is best-effort idempotent).
 */
export async function ensureAgentRunners(
  context: vscode.ExtensionContext,
): Promise<AgentRunnerPaths> {
  const storageDir = context.globalStorageUri;
  await vscode.workspace.fs.createDirectory(storageDir);

  const mcpDst = vscode.Uri.joinPath(storageDir, 'mcp.js');
  const cliDst = vscode.Uri.joinPath(storageDir, 'cli.js');

  await Promise.all([
    copyFile(vscode.Uri.joinPath(context.extensionUri, 'dist', 'mcp.js'), mcpDst),
    copyFile(vscode.Uri.joinPath(context.extensionUri, 'dist', 'cli.js'), cliDst),
  ]);

  return { mcpPath: mcpDst.fsPath, cliPath: cliDst.fsPath };
}

/** Read `src` and write it to `dst`, overwriting. */
async function copyFile(src: vscode.Uri, dst: vscode.Uri): Promise<void> {
  const bytes = await vscode.workspace.fs.readFile(src);
  await vscode.workspace.fs.writeFile(dst, bytes);
}
