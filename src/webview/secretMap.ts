/**
 * Secret Map — the webview's animated, force-directed visualization of where every secret
 * is referenced from. This is the thin DOM/canvas shell; all the graph + physics math is
 * the pure, unit-tested {@link ../engine/secretMapModel}. It is a *re-visualization* of the
 * `TreeState` already shipped to the panel — no detection, no network, and only the masked
 * preview + fingerprint + counts (never a raw secret) ever reach here.
 *
 * Lifecycle: `main.ts` recreates the `#mapHost` element on every `innerHTML` re-render, so
 * `mount()` is idempotent — it re-parents the persistent canvas into the new host while
 * preserving the live simulation. The rAF loop settles then stops; it pauses when hidden and
 * is fully torn down by `destroy()` when the user leaves the Map tab.
 */
import {
  ALPHA_MIN,
  buildGraphModel,
  buildTreeModel,
  capForNodeCount,
  defaultForceParams,
  FILE_RADIUS,
  forceStep,
  kineticEnergy,
  nodeRadius,
  SECRET_RADIUS,
  seedPosition,
  severityColorVars,
  treeLayout,
  type ForceParams,
  type GraphInput,
  type GraphModel,
  type GraphNode,
  type LayoutBounds,
  type RenderPolicy,
  type SimEdge,
  type SimNode,
  type TreeGraphModel,
  type TreePosition,
} from '../engine/secretMapModel';
import type { PanelToHost, Severity, TreeState } from '../extension/panel/protocol';

/** Public surface consumed by `main.ts`. */
export interface SecretMapController {
  mount(container: HTMLElement, tree: TreeState): void;
  update(tree: TreeState): void;
  destroy(): void;
}

type Send = (message: PanelToHost) => void;

/** Which layout the map is showing. */
type LayoutMode = 'tree' | 'force';

/** A pan/zoom camera mapping world coordinates to the canvas. */
interface Camera {
  offsetX: number;
  offsetY: number;
  scale: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
/** Leave a small breathing margin when fitting a layout to the canvas. */
const FIT_PADDING = 0.92;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

const SEVERITY_FALLBACK: Record<Severity, string> = {
  critical: '#f14c4c',
  high: '#cca700',
  medium: '#cca700',
  low: '#3794ff',
};

/** Hardcoded fallback green for safe (.env gitignored) nodes, matching the editor underline. */
const SAFE_FALLBACK = '#3fb950';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** First non-empty resolved value among `names`, else `fallback`. */
function cssVar(names: readonly string[], fallback: string): string {
  const cs = getComputedStyle(document.body);
  for (const name of names) {
    const v = cs.getPropertyValue(name).trim();
    if (v) {
      return v;
    }
  }
  return fallback;
}

interface Palette {
  fg: string;
  muted: string;
  border: string;
  font: string;
  severity: Record<Severity, string>;
  /** Fill colour for safe (gitignored .env) secret nodes. */
  safe: string;
}

class SecretMap implements SecretMapController {
  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private tooltip: HTMLDivElement | null = null;
  private banner: HTMLDivElement | null = null;
  private srList: HTMLElement | null = null;

  private model: GraphModel = { nodes: [], edges: [] };
  private sim: SimNode[] = [];
  private simEdges: SimEdge[] = [];
  private signature = '';
  /**
   * IDs of secret graph nodes that are "safe" (live exclusively in gitignored .env files).
   * Maintained in parallel with `model.nodes` — we cannot add `safe` to the engine's
   * `GraphNode` type, so we track it here in the webview shell instead.
   */
  private safeNodeIds = new Set<string>();
  private policy: RenderPolicy = { animate: true, renderLimit: 0, disclosed: false };

  // Tree layout (the default view): a static, tidy file→secret tree.
  private layoutMode: LayoutMode = 'tree';
  private treeModel: TreeGraphModel = { nodes: [], edges: [] };
  private treePos: readonly TreePosition[] = [];
  private treeBounds: LayoutBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  private treePolicy: RenderPolicy = { animate: false, renderLimit: 0, disclosed: false };
  private treeRenderLimit = 0;
  private camera: Camera = { offsetX: 0, offsetY: 0, scale: 1 };
  /** Re-fit on the next kick (set on new data or a mode switch; cleared once applied). */
  private fitPending = true;
  private controls: HTMLDivElement | null = null;

  // Pan bookkeeping (tree mode: drag empty space to pan).
  private panning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panOriginX = 0;
  private panOriginY = 0;
  private pendingClick = -1;

  private params: ForceParams = defaultForceParams(0, 0);
  private alpha = 1;
  private rafId: number | null = null;
  private paused = false;
  private reducedMotion = false;

  private width = 0;
  private height = 0;
  private dpr = 1;

  private hovered = -1;
  private dragging = -1;
  private downX = 0;
  private downY = 0;
  private movedWhileDown = false;

  private palette: Palette | null = null;

  private ro: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private motionQuery: MediaQueryList | null = null;

  // Bound handlers (stored so they can be removed in destroy()).
  private readonly onPointerDown = (e: PointerEvent) => this.handlePointerDown(e);
  private readonly onPointerMove = (e: PointerEvent) => this.handlePointerMove(e);
  private readonly onPointerUp = (e: PointerEvent) => this.handlePointerUp(e);
  private readonly onPointerLeave = () => this.clearHover();
  private readonly onWheel = (e: WheelEvent) => this.handleWheel(e);
  private readonly onControlsClick = (e: MouseEvent) => this.handleControlsClick(e);
  private readonly onVisibility = () => this.handleVisibility();
  private readonly onThemeChange = () => {
    this.palette = null;
    this.requestDraw();
  };
  private readonly tick = () => this.runTick();

  constructor(private readonly send: Send) {}

  // ── lifecycle ───────────────────────────────────────────────────────────

  mount(container: HTMLElement, tree: TreeState): void {
    this.container = container;
    if (!this.canvas) {
      this.createElements();
      this.buildFromTree(tree, /* reheat */ true);
    }
    this.attachElements(container);
    this.resize();
    this.kick();
  }

  update(tree: TreeState): void {
    if (!this.canvas) {
      return;
    }
    this.buildFromTree(tree, /* reheat */ true);
    this.resize();
    this.kick();
  }

  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.ro?.disconnect();
    this.themeObserver?.disconnect();
    this.motionQuery?.removeEventListener('change', this.onThemeChange);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.controls?.removeEventListener('click', this.onControlsClick);
    this.canvas?.removeEventListener('wheel', this.onWheel);
    this.canvas?.remove();
    this.tooltip?.remove();
    this.banner?.remove();
    this.controls?.remove();
    this.srList?.remove();
    this.canvas = null;
    this.ctx = null;
    this.tooltip = null;
    this.banner = null;
    this.controls = null;
    this.srList = null;
    this.container = null;
    this.model = { nodes: [], edges: [] };
    this.sim = [];
    this.simEdges = [];
    this.signature = '';
    this.safeNodeIds = new Set();
    this.treeModel = { nodes: [], edges: [] };
    this.treePos = [];
    this.treeRenderLimit = 0;
    this.hovered = -1;
    this.dragging = -1;
    this.panning = false;
    this.pendingClick = -1;
    this.palette = null;
  }

  // ── setup ───────────────────────────────────────────────────────────────

  private createElements(): void {
    const canvas = document.createElement('canvas');
    canvas.className = 'absolute inset-0 block h-full w-full outline-none';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('tabindex', '0');
    canvas.setAttribute('aria-label', 'Secret reference map');
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });

    this.controls = this.createControls();

    const tooltip = document.createElement('div');
    tooltip.className =
      'pointer-events-none absolute z-20 hidden max-w-xs px-2 py-1 rounded bg-bg border border-border text-fg text-xs shadow';
    this.tooltip = tooltip;

    const srList = document.createElement('div');
    srList.className = 'sr-only';
    this.srList = srList;

    this.ro = new ResizeObserver(() => this.resize());
    this.themeObserver = new MutationObserver(this.onThemeChange);
    this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });

    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.motionQuery.matches;
    this.motionQuery.addEventListener('change', this.onThemeChange);

    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private attachElements(container: HTMLElement): void {
    if (this.canvas) {
      container.appendChild(this.canvas);
    }
    if (this.banner) {
      container.appendChild(this.banner);
    }
    if (this.controls) {
      container.appendChild(this.controls);
    }
    if (this.tooltip) {
      container.appendChild(this.tooltip);
    }
    if (this.srList) {
      container.appendChild(this.srList);
    }
    this.ro?.disconnect();
    this.ro?.observe(container);
  }

  /** Build the Tree/Force + zoom control overlay (local UI — no host round-trip). */
  private createControls(): HTMLDivElement {
    const bar = document.createElement('div');
    bar.className =
      'absolute right-0 top-0 z-20 m-2 flex items-center gap-1 rounded border border-border bg-bg p-1 text-xs';
    const btn = (action: string, label: string, ariaLabel: string): string =>
      `<button type="button" data-map-action="${action}" aria-label="${ariaLabel}" ` +
      `class="px-1.5 py-0.5 rounded border border-border text-fg hover:bg-badge">${label}</button>`;
    bar.innerHTML =
      btn('mode-tree', 'Tree', 'Tree layout') +
      btn('mode-force', 'Force', 'Force-directed layout') +
      `<span class="mx-1 w-px self-stretch bg-border"></span>` +
      btn('zoom-out', '−', 'Zoom out') +
      btn('zoom-in', '+', 'Zoom in') +
      btn('fit', 'Fit', 'Fit to view');
    bar.addEventListener('click', this.onControlsClick);
    this.syncControls(bar);
    return bar;
  }

  /** Reflect the active layout mode on the toggle buttons. */
  private syncControls(bar: HTMLElement | null = this.controls): void {
    if (!bar) {
      return;
    }
    bar.querySelectorAll<HTMLElement>('[data-map-action^="mode-"]').forEach((el) => {
      const active = el.dataset.mapAction === `mode-${this.layoutMode}`;
      el.setAttribute('aria-pressed', String(active));
      el.classList.toggle('bg-badge', active);
      el.classList.toggle('text-badgeFg', active);
    });
  }

  private handleControlsClick(e: MouseEvent): void {
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-map-action]');
    const action = target?.dataset.mapAction;
    if (!action) {
      return;
    }
    switch (action) {
      case 'mode-tree':
        this.setMode('tree');
        break;
      case 'mode-force':
        this.setMode('force');
        break;
      case 'zoom-in':
        this.zoomAt(this.width / 2, this.height / 2, 1.2);
        break;
      case 'zoom-out':
        this.zoomAt(this.width / 2, this.height / 2, 1 / 1.2);
        break;
      case 'fit':
        this.fitToView();
        this.requestDraw();
        break;
    }
  }

  /** Switch layout mode: cancel the force loop when leaving it, re-fit, redraw. */
  private setMode(mode: LayoutMode): void {
    if (mode === this.layoutMode) {
      return;
    }
    this.layoutMode = mode;
    this.clearHover();
    this.dragging = -1;
    this.panning = false;
    this.pendingClick = -1;
    this.fitPending = true; // reframe for the layout we're switching to
    if (mode === 'force') {
      // Force self-centres via gravity; reset any tree pan/zoom to its identity camera.
      this.camera = { offsetX: 0, offsetY: 0, scale: 1 };
    }
    this.syncControls();
    this.renderBanner();
    this.kick();
  }

  /** Map TreeState → the pure models, (re)build the simulation, preserving positions. */
  private buildFromTree(tree: TreeState, reheat: boolean): void {
    // Collect safe fingerprints before mapping — the engine's GraphInputSecret has no `safe`
    // field, so we track which node IDs are safe locally and apply the green fill in drawNode.
    const safeFingerprints = new Set(
      tree.secrets.filter((s) => s.safe).map((s) => s.fingerprint),
    );

    const input: GraphInput = {
      secrets: tree.secrets.map((s) => ({
        fingerprint: s.fingerprint,
        ruleName: s.ruleName,
        severity: s.severity,
        preview: s.preview,
        totalCount: s.totalCount,
        files: s.files.map((f) => ({
          file: f.file,
          count: f.count,
          firstLoc: f.occurrences[0].loc,
        })),
      })),
    };
    const model = buildGraphModel(input);

    const signature = model.nodes.map((n) => n.id).join('\n');
    if (signature === this.signature && this.sim.length > 0) {
      return; // unchanged data — don't disturb the layout
    }

    // Build the tidy tree once from the same input; it is deterministic and canvas-independent,
    // so it never needs the position-preservation that the force layout does.
    this.treeModel = buildTreeModel(input);
    const layout = treeLayout(this.treeModel);
    this.treePos = layout.positions;
    this.treeBounds = layout.bounds;
    this.treePolicy = capForNodeCount(this.treeModel.nodes.length);
    this.treeRenderLimit = this.treePolicy.renderLimit;
    this.fitPending = true; // new data → reframe on the next kick

    const policy = capForNodeCount(model.nodes.length);
    const usedNodes = model.nodes.slice(0, policy.renderLimit);
    const usedEdges = model.edges.filter(
      (e) => e.source < policy.renderLimit && e.target < policy.renderLimit,
    );

    const cx = this.width / 2 || 160;
    const cy = this.height / 2 || 160;
    const prev = new Map<string, SimNode>();
    this.model.nodes.forEach((n, i) => prev.set(n.id, this.sim[i]));

    this.sim = usedNodes.map((node, i) => {
      const old = prev.get(node.id);
      const seed = seedPosition(i, cx, cy);
      const scale = node.kind === 'secret' ? SECRET_RADIUS : FILE_RADIUS;
      return {
        x: old?.x ?? seed.x,
        y: old?.y ?? seed.y,
        vx: old?.vx ?? 0,
        vy: old?.vy ?? 0,
        r: nodeRadius(node.count, scale),
      };
    });
    this.simEdges = usedEdges;
    this.model = { nodes: usedNodes, edges: usedEdges };
    this.signature = signature;
    this.policy = policy;

    // Rebuild the safe-node index from the fingerprints we collected above. A secret node's
    // graph ID is always `secret:<fingerprint>` (see buildGraphModel in secretMapModel.ts).
    this.safeNodeIds = new Set(
      [...safeFingerprints].map((fp) => `secret:${fp}`),
    );

    this.hovered = -1;
    this.dragging = -1;
    if (reheat) {
      this.alpha = Math.max(this.alpha, 0.9);
    }
    this.renderBanner();
    this.renderSrList();
  }

  // ── render loop ──────────────────────────────────────────────────────────

  /** Animate only when the graph is small enough AND the user allows motion. */
  private shouldAnimate(): boolean {
    return this.policy.animate && !this.reducedMotion;
  }

  /** Start animating, or compute a settled static layout, depending on mode/policy/motion. */
  private kick(): void {
    if (this.layoutMode === 'tree') {
      // The tree is static: stop any in-flight force frame, (re)frame if needed, draw once.
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      if (this.fitPending) {
        this.fitToView();
        this.fitPending = false;
      }
      this.draw();
      return;
    }
    if (this.sim.length === 0) {
      this.draw();
      return;
    }
    if (this.shouldAnimate()) {
      this.startLoop();
    } else {
      this.settleSync();
    }
  }

  private startLoop(): void {
    if (this.layoutMode === 'force' && this.shouldAnimate() && this.rafId === null && !this.paused) {
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  private runTick(): void {
    this.rafId = null;
    if (this.paused || !this.canvas || this.layoutMode === 'tree') {
      return;
    }
    this.alpha = forceStep(this.sim, this.simEdges, this.alpha, this.params);
    this.draw();
    const settled = this.alpha < ALPHA_MIN && kineticEnergy(this.sim) < 0.05 * this.sim.length + 0.01;
    if (this.dragging !== -1 || !settled) {
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  private settleSync(): void {
    const iters = this.sim.length > 800 ? 50 : 100;
    let alpha = 1;
    for (let i = 0; i < iters; i++) {
      alpha = forceStep(this.sim, this.simEdges, alpha, this.params);
    }
    this.alpha = ALPHA_MIN;
    this.draw();
  }

  /** Draw a single frame when the loop is idle (hover/theme changes). */
  private requestDraw(): void {
    if (this.rafId === null) {
      this.draw();
    }
  }

  // ── camera (pan / zoom / fit) ────────────────────────────────────────────────

  /** Map a screen (CSS-pixel) point to world coordinates through the current camera. */
  private toWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.camera.offsetX) / this.camera.scale,
      y: (sy - this.camera.offsetY) / this.camera.scale,
    };
  }

  /** Zoom by `factor` about a screen anchor, keeping that world point under the cursor. */
  private zoomAt(sx: number, sy: number, factor: number): void {
    const scale = clamp(this.camera.scale * factor, MIN_SCALE, MAX_SCALE);
    const w = this.toWorld(sx, sy);
    this.camera = { scale, offsetX: sx - w.x * scale, offsetY: sy - w.y * scale };
    this.requestDraw();
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const { x, y } = this.pointerPos(e);
    this.zoomAt(x, y, e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }

  /** World-space extent of the force simulation (with radii), for fit-to-view. */
  private forceBounds(): LayoutBounds {
    if (this.sim.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of this.sim) {
      minX = Math.min(minX, n.x - n.r);
      minY = Math.min(minY, n.y - n.r);
      maxX = Math.max(maxX, n.x + n.r);
      maxY = Math.max(maxY, n.y + n.r);
    }
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  /** Centre and scale the active layout to fit the canvas. */
  private fitToView(): void {
    const b = this.layoutMode === 'tree' ? this.treeBounds : this.forceBounds();
    if (b.width <= 0 || b.height <= 0 || this.width <= 0 || this.height <= 0) {
      this.camera = { offsetX: 0, offsetY: 0, scale: 1 };
      return;
    }
    const scale = clamp(Math.min(this.width / b.width, this.height / b.height) * FIT_PADDING, MIN_SCALE, MAX_SCALE);
    this.camera = {
      scale,
      offsetX: (this.width - b.width * scale) / 2 - b.minX * scale,
      offsetY: (this.height - b.height * scale) / 2 - b.minY * scale,
    };
  }

  private resolvePalette(): Palette {
    if (this.palette) {
      return this.palette;
    }
    const muted = cssVar(['--vscode-descriptionForeground'], '#888888');
    this.palette = {
      fg: cssVar(['--vscode-foreground'], '#cccccc'),
      muted,
      border: cssVar(['--vscode-panel-border', '--vscode-editorWidget-border'], muted),
      font: cssVar(['--vscode-font-family'], 'sans-serif'),
      severity: {
        critical: cssVar(severityColorVars('critical'), SEVERITY_FALLBACK.critical),
        high: cssVar(severityColorVars('high'), SEVERITY_FALLBACK.high),
        medium: cssVar(severityColorVars('medium'), SEVERITY_FALLBACK.medium),
        low: cssVar(severityColorVars('low'), SEVERITY_FALLBACK.low),
      },
      // Safe nodes use the same green as the editor's gitignored .env underline decoration
      // (`--vscode-charts-green`) with a stable hex fallback.
      safe: cssVar(['--vscode-charts-green', '--vscode-testing-iconPassed'], SAFE_FALLBACK),
    };
    return this.palette;
  }

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx || this.width <= 0 || this.height <= 0) {
      return;
    }
    const p = this.resolvePalette();
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.save();
    ctx.translate(this.camera.offsetX, this.camera.offsetY);
    ctx.scale(this.camera.scale, this.camera.scale);
    if (this.layoutMode === 'tree') {
      this.drawTree(ctx, p);
    } else {
      this.drawForce(ctx, p);
    }
    ctx.restore();
  }

  /** Fill/stroke a node circle (filled for secrets by severity, hollow for files). */
  private drawNode(
    ctx: CanvasRenderingContext2D,
    p: Palette,
    node: GraphNode,
    pos: { x: number; y: number; r: number },
    glow: boolean,
  ): void {
    if (node.kind === 'file') {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = p.muted;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, pos.r, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // Safe secret nodes (gitignored .env) render in calm green instead of the severity
      // color so they visually match the green section in the List and Tree views.
      const color = this.safeNodeIds.has(node.id) ? p.safe : p.severity[node.severity];
      if (glow) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, pos.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  /** Outlined label so text stays legible over any node colour. */
  private drawLabel(ctx: CanvasRenderingContext2D, p: Palette, label: string, x: number, y: number): void {
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(label, x, y);
    ctx.fillStyle = p.fg;
    ctx.fillText(label, x, y);
  }

  private drawForce(ctx: CanvasRenderingContext2D, p: Palette): void {
    // Edges.
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = p.border;
    for (const e of this.simEdges) {
      const s = this.sim[e.source];
      const t = this.sim[e.target];
      ctx.lineWidth = Math.min(2.5, 0.5 + Math.log2(1 + e.weight) * 0.5);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const glow = this.sim.length <= 120;
    this.model.nodes.forEach((node, i) => this.drawNode(ctx, p, node, this.sim[i], glow));

    // Labels for the top few secrets (already sorted first by the host).
    ctx.font = `11px ${p.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i < this.model.nodes.length && i < 3; i++) {
      const node = this.model.nodes[i];
      if (node.kind !== 'secret') {
        continue;
      }
      const n = this.sim[i];
      this.drawLabel(ctx, p, node.label, n.x, n.y + n.r + 2);
    }

    this.drawHoverRing(ctx, p, this.sim[this.hovered]);
  }

  private drawTree(ctx: CanvasRenderingContext2D, p: Palette): void {
    const limit = this.treeRenderLimit;
    // Elbow links from each file root down to its secret leaves.
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = p.border;
    for (const e of this.treeModel.edges) {
      if (e.target >= limit) {
        continue;
      }
      const s = this.treePos[e.source];
      const t = this.treePos[e.target];
      const midY = (s.y + t.y) / 2;
      ctx.lineWidth = Math.min(2.5, 0.5 + Math.log2(1 + e.weight) * 0.5);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y + s.r);
      ctx.lineTo(s.x, midY);
      ctx.lineTo(t.x, midY);
      ctx.lineTo(t.x, t.y - t.r);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const glow = limit <= 120;
    for (let i = 0; i < limit; i++) {
      this.drawNode(ctx, p, this.treeModel.nodes[i], this.treePos[i], glow);
    }

    // File-root labels above each source node.
    ctx.font = `11px ${p.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let i = 0; i < limit; i++) {
      const node = this.treeModel.nodes[i];
      if (node.depth !== 0) {
        continue;
      }
      const pos = this.treePos[i];
      this.drawLabel(ctx, p, node.label, pos.x, pos.y - pos.r - 3);
    }

    if (this.hovered < limit) {
      this.drawHoverRing(ctx, p, this.treePos[this.hovered]);
    }
  }

  private drawHoverRing(ctx: CanvasRenderingContext2D, p: Palette, pos: { x: number; y: number; r: number } | undefined): void {
    if (this.hovered === -1 || !pos) {
      return;
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = p.fg;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, pos.r + 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ── sizing ────────────────────────────────────────────────────────────────

  private resize(): void {
    const container = this.container;
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!container || !canvas || !ctx) {
      return;
    }
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w <= 0 || h <= 0) {
      this.paused = true;
      return;
    }
    this.paused = false;
    this.dpr = window.devicePixelRatio || 1;
    const changed = w !== this.width || h !== this.height;
    this.width = w;
    this.height = h;
    canvas.width = Math.round(w * this.dpr);
    canvas.height = Math.round(h * this.dpr);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.params = { ...this.params, centerX: w / 2, centerY: h / 2 };
    if (changed && this.layoutMode === 'force' && this.shouldAnimate()) {
      this.alpha = Math.max(this.alpha, 0.3);
      this.startLoop();
    }
    this.draw();
  }

  private handleVisibility(): void {
    if (document.hidden) {
      this.paused = true;
    } else {
      this.paused = false;
      this.startLoop();
      this.requestDraw();
    }
  }

  // ── interaction ────────────────────────────────────────────────────────────

  private pointerPos(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.canvas!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** Number of currently-rendered nodes (capped slice in tree mode). */
  private activeCount(): number {
    return this.layoutMode === 'tree' ? this.treeRenderLimit : this.sim.length;
  }

  /** Position+radius of the active layout's node `i`. */
  private activePos(i: number): { x: number; y: number; r: number } | undefined {
    return this.layoutMode === 'tree' ? this.treePos[i] : this.sim[i];
  }

  /** Display node for the active layout at index `i`. */
  private activeNode(i: number): GraphNode | undefined {
    return this.layoutMode === 'tree' ? this.treeModel.nodes[i] : this.model.nodes[i];
  }

  /** Hit-test in WORLD coordinates; slop stays ~constant on screen across zoom. */
  private hitTest(wx: number, wy: number): number {
    const slop = 4 / this.camera.scale;
    for (let i = this.activeCount() - 1; i >= 0; i--) {
      const pos = this.activePos(i);
      if (!pos) {
        continue;
      }
      const dx = wx - pos.x;
      const dy = wy - pos.y;
      const hr = pos.r + slop;
      if (dx * dx + dy * dy <= hr * hr) {
        return i;
      }
    }
    return -1;
  }

  /** True once the pointer has moved past the click/drag threshold since press. */
  private movedPast(sx: number, sy: number): boolean {
    return Math.abs(sx - this.downX) > 3 || Math.abs(sy - this.downY) > 3;
  }

  private handlePointerDown(e: PointerEvent): void {
    const sp = this.pointerPos(e);
    this.downX = sp.x;
    this.downY = sp.y;
    this.movedWhileDown = false;
    const w = this.toWorld(sp.x, sp.y);
    const hit = this.hitTest(w.x, w.y);

    if (this.layoutMode === 'force') {
      if (hit !== -1) {
        this.dragging = hit;
        const n = this.sim[hit];
        n.fx = w.x;
        n.fy = w.y;
        n.x = w.x;
        n.y = w.y;
        this.canvas!.setPointerCapture(e.pointerId);
        this.alpha = Math.max(this.alpha, 0.4);
        this.startLoop();
        this.requestDraw();
      }
      return;
    }

    // Tree mode: tap a node to jump, drag empty space to pan.
    this.canvas!.setPointerCapture(e.pointerId);
    if (hit !== -1) {
      this.pendingClick = hit;
    } else {
      this.panning = true;
      this.panStartX = sp.x;
      this.panStartY = sp.y;
      this.panOriginX = this.camera.offsetX;
      this.panOriginY = this.camera.offsetY;
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    const sp = this.pointerPos(e);

    if (this.layoutMode === 'force' && this.dragging !== -1) {
      if (this.movedPast(sp.x, sp.y)) {
        this.movedWhileDown = true;
      }
      const w = this.toWorld(sp.x, sp.y);
      const n = this.sim[this.dragging];
      n.fx = w.x;
      n.fy = w.y;
      n.x = w.x;
      n.y = w.y;
      this.alpha = Math.max(this.alpha, 0.2);
      this.startLoop();
      this.requestDraw(); // moves the node even when the loop is gated off (reduced motion)
      return;
    }

    if (this.layoutMode === 'tree') {
      if (this.panning) {
        this.camera = {
          ...this.camera,
          offsetX: this.panOriginX + (sp.x - this.panStartX),
          offsetY: this.panOriginY + (sp.y - this.panStartY),
        };
        this.requestDraw();
        return;
      }
      if (this.pendingClick !== -1) {
        if (this.movedPast(sp.x, sp.y)) {
          this.movedWhileDown = true;
        }
        return; // suppress hover while a tap is in progress
      }
    }

    const w = this.toWorld(sp.x, sp.y);
    const hit = this.hitTest(w.x, w.y);
    if (hit !== this.hovered) {
      this.hovered = hit;
      this.requestDraw();
    }
    if (hit === -1) {
      this.hideTooltip();
    } else {
      this.showTooltip(hit, sp.x, sp.y);
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    if (this.layoutMode === 'force') {
      if (this.dragging !== -1) {
        const node = this.sim[this.dragging];
        node.fx = null;
        node.fy = null;
        const clicked = this.dragging;
        this.dragging = -1;
        this.alpha = Math.max(this.alpha, 0.3);
        this.startLoop();
        this.requestDraw();
        if (!this.movedWhileDown) {
          this.jumpTo(clicked);
        }
        return;
      }
      const sp = this.pointerPos(e);
      const w = this.toWorld(sp.x, sp.y);
      const hit = this.hitTest(w.x, w.y);
      if (hit !== -1 && !this.movedPast(sp.x, sp.y)) {
        this.jumpTo(hit);
      }
      return;
    }

    // Tree mode.
    if (this.panning) {
      this.panning = false;
      return;
    }
    if (this.pendingClick !== -1) {
      const clicked = this.pendingClick;
      this.pendingClick = -1;
      if (!this.movedWhileDown) {
        this.jumpTo(clicked);
      }
    }
  }

  private jumpTo(index: number): void {
    const node = this.activeNode(index);
    if (node) {
      this.send({ type: 'jumpTo', loc: node.loc });
    }
  }

  private clearHover(): void {
    if (this.hovered !== -1) {
      this.hovered = -1;
      this.requestDraw();
    }
    this.hideTooltip();
  }

  // ── tooltip / banner / a11y mirror ──────────────────────────────────────────

  private showTooltip(index: number, x: number, y: number): void {
    const tip = this.tooltip;
    const node = this.activeNode(index);
    if (!tip || !node) {
      return;
    }
    tip.innerHTML = this.tooltipHtml(node);
    tip.classList.remove('hidden');
    const maxX = this.width - tip.offsetWidth - 8;
    const maxY = this.height - tip.offsetHeight - 8;
    tip.style.left = `${Math.max(4, Math.min(x + 12, maxX))}px`;
    tip.style.top = `${Math.max(4, Math.min(y + 12, maxY))}px`;
  }

  private hideTooltip(): void {
    this.tooltip?.classList.add('hidden');
  }

  private tooltipHtml(node: GraphNode): string {
    if (node.kind === 'secret') {
      // Safe nodes get an extra "Safe (.env)" badge so the tooltip is coherent with the
      // green fill — it's clear this isn't a red leak, just a well-placed secret.
      const safeBadge = this.safeNodeIds.has(node.id)
        ? `<div class="text-ok">Safe (.env gitignored)</div>`
        : '';
      return (
        `<div class="font-medium">${escapeHtml(node.label)}</div>` +
        safeBadge +
        `<div class="font-mono break-all">${escapeHtml(node.preview ?? '')}</div>` +
        `<div class="text-muted">${node.count} reference(s) · ${node.fileCount ?? 0} file(s)</div>`
      );
    }
    return (
      `<div class="font-medium break-all">${escapeHtml(node.title)}</div>` +
      `<div class="text-muted">${node.count} reference(s) here · ${node.secretCount ?? 0} secret(s)</div>`
    );
  }

  private renderBanner(): void {
    const container = this.container;
    if (!container) {
      return;
    }
    const tree = this.layoutMode === 'tree';
    const policy = tree ? this.treePolicy : this.policy;
    if (!policy.disclosed) {
      this.banner?.remove();
      this.banner = null;
      return;
    }
    if (!this.banner) {
      this.banner = document.createElement('div');
      this.banner.className =
        'absolute left-0 right-0 top-0 z-10 m-2 px-2 py-1 rounded bg-badge text-badgeFg text-xs';
      // Keep the banner above the canvas but below the controls overlay.
      container.appendChild(this.banner);
    }
    const total = tree ? this.treeModel.nodes.length : this.signature.split('\n').length;
    this.banner.textContent = `Showing ${policy.renderLimit} of ${total} nodes — open the Findings list for the full list.`;
  }

  private renderSrList(): void {
    const el = this.srList;
    if (!el) {
      return;
    }
    const secrets = this.model.nodes.filter((n) => n.kind === 'secret');
    const items = secrets
      .map(
        (n) =>
          `<li>${escapeHtml(n.label)} — ${escapeHtml(n.preview ?? '')} — ${n.count} reference(s) in ${n.fileCount ?? 0} file(s)</li>`,
      )
      .join('');
    el.innerHTML = `<p>Secret map: ${secrets.length} secret(s).</p><ul>${items}</ul>`;
  }
}

/** Create a Secret Map controller. `send` posts messages (jumpTo) back to the host. */
export function createSecretMap(send: Send): SecretMapController {
  return new SecretMap(send);
}
