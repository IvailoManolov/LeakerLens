/**
 * The webview message protocol for the LeakerLens findings panel.
 *
 * Imported by BOTH the extension host (`panelController.ts`) and the webview client
 * (`src/webview/main.ts`). It is the only thing the webview knows about — the webview
 * never runs detection, it only renders {@link PanelState} and emits {@link PanelToHost}
 * actions. Kept free of `vscode` imports so the browser bundle stays clean.
 */
import type { RemediationKind, Severity } from '../../engine/types';

export type { RemediationKind, Severity };

/**
 * A precise location, carried as separate fields (never a delimited string) so it can't
 * be corrupted when written into the webview DOM and sent back.
 */
export interface Locator {
  /** `vscode.Uri.toString()` of the document (percent-encoded, attribute-safe). */
  readonly uri: string;
  readonly start: number;
  readonly end: number;
}

/** A finding flattened for display in the panel. */
export interface PanelFinding {
  /** Document location, used for jump/remediate round-trips. */
  readonly loc: Locator;
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
  /**
   * True when this finding lives in a gitignored `.env` file — a secret that's where it
   * belongs. The panel renders it green and excludes it from the leak count.
   */
  readonly safe?: boolean;
}

/** Findings grouped under one severity. */
export interface SeverityGroup {
  readonly severity: Severity;
  readonly count: number;
  readonly items: readonly PanelFinding[];
}

/** The "safe" findings living in gitignored `.env` files: shown green, never counted. */
export interface SafeGroup {
  readonly count: number;
  readonly items: readonly PanelFinding[];
}

/** Which visualization the panel is showing. */
export type PanelView = 'list' | 'tree' | 'map';

/** One occurrence of a secret. */
export interface TreeOccurrence {
  readonly loc: Locator;
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
  /** True for a secret that only lives in gitignored `.env` files (rendered green). */
  readonly safe?: boolean;
}

/**
 * The "where is each secret referenced from" tree. `secrets` carries both problem and safe
 * nodes (safe ones flagged via {@link TreeSecretNode.safe} and sorted last); the `total*`
 * counts cover problems only, with safe ones tallied separately in `safe*`.
 */
export interface TreeState {
  readonly secrets: readonly TreeSecretNode[];
  readonly totalSecrets: number;
  readonly totalRefs: number;
  /** Count of distinct safe (gitignored `.env`) secrets, excluded from `totalSecrets`. */
  readonly safeSecrets?: number;
  /** Count of safe references, excluded from `totalRefs`. */
  readonly safeRefs?: number;
}

/** The full state the panel renders. */
export interface PanelState {
  readonly groups: readonly SeverityGroup[];
  readonly tree: TreeState;
  /** Number of *counted* leaks (ordinary files + exposed `.env`). Excludes safe findings. */
  readonly totalCount: number;
  readonly isEmpty: boolean;
  readonly scanning: boolean;
  /** Secrets living safely in gitignored `.env` files — shown green, not part of `totalCount`. */
  readonly safeGroup?: SafeGroup;
}

/** Host → panel messages. */
export type HostToPanel =
  | { readonly type: 'state'; readonly payload: PanelState }
  | { readonly type: 'setView'; readonly view: PanelView };

/** Panel → host messages (user actions). */
export type PanelToHost =
  | { readonly type: 'ready' }
  | { readonly type: 'jumpTo'; readonly loc: Locator }
  | { readonly type: 'remediate'; readonly loc: Locator; readonly kind: RemediationKind }
  | { readonly type: 'rescan' }
  | { readonly type: 'log'; readonly text: string };
