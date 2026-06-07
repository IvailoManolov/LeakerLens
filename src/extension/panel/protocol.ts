/**
 * The webview message protocol for the LeakLens findings panel.
 *
 * Imported by BOTH the extension host (`panelController.ts`) and the webview client
 * (`src/webview/main.ts`). It is the only thing the webview knows about — the webview
 * never runs detection, it only renders {@link PanelState} and emits {@link PanelToHost}
 * actions. Kept free of `vscode` imports so the browser bundle stays clean.
 */
import type { RemediationKind, Severity } from '../../engine/types';

export type { RemediationKind, Severity };

/** A finding flattened for display in the panel. */
export interface PanelFinding {
  /** Stable id: `${file}:${start}:${ruleId}` — used for jump/remediate round-trips. */
  readonly id: string;
  readonly ruleName: string;
  readonly severity: Severity;
  /** Workspace-relative path. */
  readonly file: string;
  /** 1-based line for display. */
  readonly line: number;
  /** Masked preview. */
  readonly preview: string;
  readonly message: string;
  readonly remediations: ReadonlyArray<{ kind: RemediationKind; title: string }>;
}

/** Findings grouped under one severity. */
export interface SeverityGroup {
  readonly severity: Severity;
  readonly count: number;
  readonly items: readonly PanelFinding[];
}

/** Which visualization the panel is showing. */
export type PanelView = 'list' | 'tree';

/** One occurrence of a secret. `id` reuses the host's jump/remediate id format. */
export interface TreeOccurrence {
  readonly id: string;
  readonly line: number;
  readonly column: number;
}

/** All occurrences of a secret within a single file. */
export interface TreeFileNode {
  readonly file: string;
  readonly count: number;
  readonly occurrences: readonly TreeOccurrence[];
}

/** One unique secret value and everywhere it is referenced from. */
export interface TreeSecretNode {
  readonly fingerprint: string;
  readonly ruleName: string;
  readonly severity: Severity;
  readonly preview: string;
  readonly totalCount: number;
  readonly fileCount: number;
  readonly files: readonly TreeFileNode[];
}

/** The "where is each secret referenced from" tree. */
export interface TreeState {
  readonly secrets: readonly TreeSecretNode[];
  readonly totalSecrets: number;
  readonly totalRefs: number;
}

/** The full state the panel renders. */
export interface PanelState {
  readonly groups: readonly SeverityGroup[];
  readonly tree: TreeState;
  readonly totalCount: number;
  readonly isEmpty: boolean;
  readonly scanning: boolean;
}

/** Host → panel messages. */
export type HostToPanel =
  | { readonly type: 'state'; readonly payload: PanelState }
  | { readonly type: 'setView'; readonly view: PanelView };

/** Panel → host messages (user actions). */
export type PanelToHost =
  | { readonly type: 'ready' }
  | { readonly type: 'jumpTo'; readonly id: string }
  | { readonly type: 'remediate'; readonly id: string; readonly kind: RemediationKind }
  | { readonly type: 'rescan' };
