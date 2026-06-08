/**
 * Pure, DOM-free, vscode-free math behind the **Secret Map** webview view: building the
 * bipartite secret↔file graph and stepping a small force-directed layout. It lives in the
 * engine (alongside {@link ./entropy} and {@link ./fingerprint}) so it stays portable and
 * is exercised by the same 100%-coverage unit harness; the webview's `secretMap.ts` is the
 * thin DOM/canvas shell that drives these functions.
 *
 * Nothing here touches the DOM, `vscode`, the clock, or randomness — layouts are seeded
 * deterministically by node index so the same input always lays out the same way.
 */
import type { Severity } from './types';

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** The two node kinds in the bipartite graph. */
export type NodeKind = 'secret' | 'file';

/** A jump target — mirrors the panel's `Locator` without importing extension glue. */
export interface GraphLoc {
  readonly uri: string;
  readonly start: number;
  readonly end: number;
}

/** One file a secret is referenced from (engine-agnostic input shape). */
export interface GraphInputFile {
  readonly file: string;
  readonly count: number;
  /** Location of the first occurrence in this file (jump target). */
  readonly firstLoc: GraphLoc;
}

/** One unique secret and the files it appears in (engine-agnostic input shape). */
export interface GraphInputSecret {
  readonly fingerprint: string;
  readonly ruleName: string;
  readonly severity: Severity;
  readonly preview: string;
  readonly totalCount: number;
  readonly files: readonly GraphInputFile[];
}

/** Input to {@link buildGraphModel}: the secrets, already grouped/sorted by the host. */
export interface GraphInput {
  readonly secrets: readonly GraphInputSecret[];
}

/** A node in the rendered graph. Topology + display data only (no positions). */
export interface GraphNode {
  readonly id: string;
  readonly kind: NodeKind;
  /** Short label (rule name for secrets, file basename for files). */
  readonly label: string;
  /** Full identity for the tooltip (rule name, or full relative path). */
  readonly title: string;
  /** Secret severity; for a file, the most severe secret referencing it. */
  readonly severity: Severity;
  /** Masked preview (secret nodes only). */
  readonly preview?: string;
  /** Reference count: a secret's total, or a file's total occurrences. */
  readonly count: number;
  /** Secret nodes: how many distinct files. */
  readonly fileCount?: number;
  /** File nodes: how many distinct secrets reference this file. */
  readonly secretCount?: number;
  /** Where clicking this node jumps to. */
  readonly loc: GraphLoc;
}

/** An edge: a secret occurs in a file. Indices point into the node array. */
export interface GraphEdge {
  readonly source: number;
  readonly target: number;
  /** Occurrences of this secret in this file. */
  readonly weight: number;
}

/** The built graph. */
export interface GraphModel {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

/** Last path segment, handling both POSIX and Windows separators. */
function basename(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash === -1 ? path : path.slice(slash + 1);
}

function moreSevere(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b;
}

/**
 * Build the bipartite graph: one node per unique secret, one shared node per distinct file
 * (a file referenced by several secrets becomes a single node of higher degree), and one
 * edge per (secret, file) pair weighted by occurrence count. Deterministic: secrets keep
 * the host's order, files are ordered by first appearance.
 */
export function buildGraphModel(input: GraphInput): GraphModel {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const fileIndex = new Map<string, number>();

  // Secret nodes first (host already sorted them by severity → count → name).
  for (const secret of input.secrets) {
    nodes.push({
      id: `secret:${secret.fingerprint}`,
      kind: 'secret',
      label: secret.ruleName,
      title: secret.ruleName,
      severity: secret.severity,
      preview: secret.preview,
      count: secret.totalCount,
      fileCount: secret.files.length,
      loc: secret.files[0].firstLoc,
    });
  }

  // File nodes (created on first appearance) + edges.
  input.secrets.forEach((secret, secretNodeIndex) => {
    for (const f of secret.files) {
      let target = fileIndex.get(f.file);
      if (target === undefined) {
        target = nodes.length;
        fileIndex.set(f.file, target);
        nodes.push({
          id: `file:${f.file}`,
          kind: 'file',
          label: basename(f.file),
          title: f.file,
          severity: secret.severity,
          count: f.count,
          secretCount: 1,
          loc: f.firstLoc,
        });
      } else {
        const existing = nodes[target];
        nodes[target] = {
          ...existing,
          severity: moreSevere(existing.severity, secret.severity),
          count: existing.count + f.count,
          // File nodes always set secretCount on creation, so it is defined here.
          secretCount: (existing.secretCount as number) + 1,
        };
      }
      edges.push({ source: secretNodeIndex, target, weight: f.count });
    }
  });

  return { nodes, edges };
}

/** Radius scaling so a node's **area** tracks its reference count. */
export interface RadiusScale {
  readonly min: number;
  readonly max: number;
  readonly scale: number;
}

/** Default radii — secrets read larger than the files that contain them. */
export const SECRET_RADIUS: RadiusScale = { min: 6, max: 22, scale: 3 };
export const FILE_RADIUS: RadiusScale = { min: 4, max: 14, scale: 2 };

/**
 * Node radius from its count: `min + scale·√count`, capped at `max`. The `√count` term is
 * never negative (count is floored at 0), so the result never falls below `min`.
 */
export function nodeRadius(count: number, scale: RadiusScale): number {
  const r = scale.min + scale.scale * Math.sqrt(Math.max(0, count));
  return r > scale.max ? scale.max : r;
}

/** Above this many nodes we render a settled layout once instead of animating. */
export const ANIMATE_CAP = 250;
/** Above this many nodes we render only the top nodes and disclose the truncation. */
export const RENDER_CAP = 1500;

/** What to render for a given node count, encoding the no-silent-truncation policy. */
export interface RenderPolicy {
  /** Run the animated rAF loop (false → compute a settled layout once). */
  readonly animate: boolean;
  /** How many nodes to draw. */
  readonly renderLimit: number;
  /** True when nodes were dropped — the UI must say so. */
  readonly disclosed: boolean;
}

/** Decide animation/truncation for `n` total nodes. Never drops data silently. */
export function capForNodeCount(n: number): RenderPolicy {
  if (n <= ANIMATE_CAP) {
    return { animate: true, renderLimit: n, disclosed: false };
  }
  if (n <= RENDER_CAP) {
    return { animate: false, renderLimit: n, disclosed: false };
  }
  return { animate: false, renderLimit: RENDER_CAP, disclosed: true };
}

/**
 * Ordered VS Code theme custom-property names for a severity (primary then fallback). The
 * webview resolves the first non-empty one off `getComputedStyle` — keeping the mapping
 * here (matching tailwind.config.js) makes it testable without a DOM.
 */
const SEVERITY_COLOR_VARS: Record<Severity, readonly string[]> = {
  critical: ['--vscode-errorForeground', '--vscode-charts-red'],
  high: ['--vscode-charts-orange', '--vscode-editorWarning-foreground'],
  medium: ['--vscode-charts-yellow', '--vscode-editorWarning-foreground'],
  low: ['--vscode-charts-blue', '--vscode-textLink-foreground'],
};

/** Candidate theme variable names for a severity colour, most-preferred first. */
export function severityColorVars(severity: Severity): readonly string[] {
  return SEVERITY_COLOR_VARS[severity];
}

// ── force-directed layout ───────────────────────────────────────────────────

/** A node's mutable simulation state. */
export interface SimNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Pinned position while dragging (null/undefined = free). */
  fx?: number | null;
  fy?: number | null;
  /** Radius, used for spring spacing so nodes don't overlap. */
  readonly r: number;
}

/** An edge over simulation-node indices. */
export interface SimEdge {
  readonly source: number;
  readonly target: number;
  readonly weight: number;
}

/** Tunables for {@link forceStep}. */
export interface ForceParams {
  readonly kRepel: number;
  readonly kSpring: number;
  readonly l0: number;
  readonly kGravity: number;
  readonly velocityDecay: number;
  readonly alphaDecay: number;
  readonly centerX: number;
  readonly centerY: number;
}

/** When set on a state we treat the layout as settled and stop the loop. */
export const ALPHA_MIN = 0.02;

/** Sensible defaults centred on a canvas of the given size. */
export function defaultForceParams(centerX: number, centerY: number): ForceParams {
  return {
    kRepel: 1200,
    kSpring: 0.04,
    l0: 60,
    kGravity: 0.02,
    velocityDecay: 0.85,
    alphaDecay: 0.985,
    centerX,
    centerY,
  };
}

/** Minimum separation used to avoid divide-by-zero / huge forces at tiny distances. */
const MIN_DIST = 1;

/**
 * Seed a node's start position on a deterministic phyllotaxis ("sunflower") spiral around
 * the centre — stable across reloads, collision-free, and reproducible in tests.
 */
export function seedPosition(
  index: number,
  centerX: number,
  centerY: number,
  spacing = 16,
): { x: number; y: number } {
  const GOLDEN_ANGLE = 2.399963229728653; // π·(3 − √5)
  const radius = spacing * Math.sqrt(index + 0.5);
  const angle = index * GOLDEN_ANGLE;
  return { x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) };
}

/** Total kinetic energy — the loop stops once this is tiny and alpha has cooled. */
export function kineticEnergy(nodes: readonly SimNode[]): number {
  let e = 0;
  for (const n of nodes) {
    e += n.vx * n.vx + n.vy * n.vy;
  }
  return e;
}

/**
 * Advance the layout one tick (mutates `nodes`) and return the cooled `alpha`. Forces —
 * pairwise repulsion (O(n²)), springs along edges, and weak centring gravity — accumulate
 * into velocity (scaled by `alpha`), which is damped and added to position. Pinned nodes
 * (`fx`/`fy` set) hold their position but still push on their neighbours.
 */
export function forceStep(
  nodes: SimNode[],
  edges: readonly SimEdge[],
  alpha: number,
  params: ForceParams,
): number {
  const n = nodes.length;

  // Pairwise repulsion.
  for (let i = 0; i < n; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      let d = Math.sqrt(d2);
      if (d < MIN_DIST) {
        if (dx === 0 && dy === 0) {
          dx = MIN_DIST;
          dy = 0;
        }
        d = MIN_DIST;
        d2 = MIN_DIST * MIN_DIST;
      }
      const f = (params.kRepel / d2) * alpha;
      const ux = dx / d;
      const uy = dy / d;
      a.vx += f * ux;
      a.vy += f * uy;
      b.vx -= f * ux;
      b.vy -= f * uy;
    }
  }

  // Springs along edges (rest length shortened a little by heavier weight).
  for (const e of edges) {
    const s = nodes[e.source];
    const t = nodes[e.target];
    let dx = t.x - s.x;
    let dy = t.y - s.y;
    let d = Math.sqrt(dx * dx + dy * dy);
    if (d < MIN_DIST) {
      if (dx === 0 && dy === 0) {
        dx = MIN_DIST;
        dy = 0;
      }
      d = MIN_DIST;
    }
    const target = params.l0 / (1 + 0.1 * Math.log2(1 + e.weight)) + s.r + t.r;
    const f = params.kSpring * (d - target) * alpha;
    const ux = dx / d;
    const uy = dy / d;
    s.vx += f * ux;
    s.vy += f * uy;
    t.vx -= f * ux;
    t.vy -= f * uy;
  }

  // Centring gravity + integration.
  for (const node of nodes) {
    node.vx += (params.centerX - node.x) * params.kGravity * alpha;
    node.vy += (params.centerY - node.y) * params.kGravity * alpha;
    if (node.fx != null) {
      node.x = node.fx;
      node.vx = 0;
    } else {
      node.vx *= params.velocityDecay;
      node.x += node.vx;
    }
    if (node.fy != null) {
      node.y = node.fy;
      node.vy = 0;
    } else {
      node.vy *= params.velocityDecay;
      node.y += node.vy;
    }
  }

  return alpha * params.alphaDecay;
}
