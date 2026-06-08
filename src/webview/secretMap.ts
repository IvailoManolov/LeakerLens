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
  capForNodeCount,
  defaultForceParams,
  FILE_RADIUS,
  forceStep,
  kineticEnergy,
  nodeRadius,
  SECRET_RADIUS,
  seedPosition,
  severityColorVars,
  type ForceParams,
  type GraphModel,
  type GraphNode,
  type RenderPolicy,
  type SimEdge,
  type SimNode,
} from '../engine/secretMapModel';
import type { PanelToHost, Severity, TreeState } from '../extension/panel/protocol';

/** Public surface consumed by `main.ts`. */
export interface SecretMapController {
  mount(container: HTMLElement, tree: TreeState): void;
  update(tree: TreeState): void;
  destroy(): void;
}

type Send = (message: PanelToHost) => void;

const SEVERITY_FALLBACK: Record<Severity, string> = {
  critical: '#f14c4c',
  high: '#cca700',
  medium: '#cca700',
  low: '#3794ff',
};

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
  private policy: RenderPolicy = { animate: true, renderLimit: 0, disclosed: false };

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
    this.canvas?.remove();
    this.tooltip?.remove();
    this.banner?.remove();
    this.srList?.remove();
    this.canvas = null;
    this.ctx = null;
    this.tooltip = null;
    this.banner = null;
    this.srList = null;
    this.container = null;
    this.model = { nodes: [], edges: [] };
    this.sim = [];
    this.simEdges = [];
    this.signature = '';
    this.hovered = -1;
    this.dragging = -1;
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
    if (this.tooltip) {
      container.appendChild(this.tooltip);
    }
    if (this.srList) {
      container.appendChild(this.srList);
    }
    this.ro?.disconnect();
    this.ro?.observe(container);
  }

  /** Map TreeState → the pure model, (re)build the simulation, preserving positions. */
  private buildFromTree(tree: TreeState, reheat: boolean): void {
    const model = buildGraphModel({
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
    });

    const signature = model.nodes.map((n) => n.id).join('\n');
    if (signature === this.signature && this.sim.length > 0) {
      return; // unchanged data — don't disturb the layout
    }

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

  /** Start animating, or compute a settled static layout, depending on policy/motion. */
  private kick(): void {
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
    if (this.shouldAnimate() && this.rafId === null && !this.paused) {
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  private runTick(): void {
    this.rafId = null;
    if (this.paused || !this.canvas) {
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
    this.model.nodes.forEach((node, i) => {
      const n = this.sim[i];
      if (node.kind === 'file') {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = p.muted;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const color = p.severity[node.severity];
        if (glow) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 10;
        }
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });

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
      const ty = n.y + n.r + 2;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(node.label, n.x, ty);
      ctx.fillStyle = p.fg;
      ctx.fillText(node.label, n.x, ty);
    }

    // Hover highlight ring.
    if (this.hovered !== -1) {
      const n = this.sim[this.hovered];
      ctx.lineWidth = 2;
      ctx.strokeStyle = p.fg;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
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
    if (changed && this.shouldAnimate()) {
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

  private pointerPos(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private hitTest(x: number, y: number): number {
    for (let i = this.sim.length - 1; i >= 0; i--) {
      const n = this.sim[i];
      const dx = x - n.x;
      const dy = y - n.y;
      if (dx * dx + dy * dy <= (n.r + 4) * (n.r + 4)) {
        return i;
      }
    }
    return -1;
  }

  private handlePointerDown(e: PointerEvent): void {
    const { x, y } = this.pointerPos(e);
    this.downX = x;
    this.downY = y;
    this.movedWhileDown = false;
    const hit = this.hitTest(x, y);
    if (hit !== -1) {
      this.dragging = hit;
      const n = this.sim[hit];
      n.fx = x;
      n.fy = y;
      n.x = x;
      n.y = y;
      this.canvas!.setPointerCapture(e.pointerId);
      this.alpha = Math.max(this.alpha, 0.4);
      this.startLoop();
      this.requestDraw();
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    const { x, y } = this.pointerPos(e);
    if (this.dragging !== -1) {
      if (Math.abs(x - this.downX) > 3 || Math.abs(y - this.downY) > 3) {
        this.movedWhileDown = true;
      }
      const n = this.sim[this.dragging];
      n.fx = x;
      n.fy = y;
      n.x = x;
      n.y = y;
      this.alpha = Math.max(this.alpha, 0.2);
      this.startLoop();
      this.requestDraw(); // moves the node even when the loop is gated off (reduced motion)
      return;
    }
    const hit = this.hitTest(x, y);
    if (hit !== this.hovered) {
      this.hovered = hit;
      this.requestDraw();
    }
    if (hit === -1) {
      this.hideTooltip();
    } else {
      this.showTooltip(hit, x, y);
    }
  }

  private handlePointerUp(e: PointerEvent): void {
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
    const { x, y } = this.pointerPos(e);
    const hit = this.hitTest(x, y);
    if (hit !== -1 && Math.abs(x - this.downX) <= 3 && Math.abs(y - this.downY) <= 3) {
      this.jumpTo(hit);
    }
  }

  private jumpTo(index: number): void {
    const node = this.model.nodes[index];
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
    const node = this.model.nodes[index];
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
      return (
        `<div class="font-medium">${escapeHtml(node.label)}</div>` +
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
    if (!this.policy.disclosed) {
      this.banner?.remove();
      this.banner = null;
      return;
    }
    if (!this.banner) {
      this.banner = document.createElement('div');
      this.banner.className =
        'absolute left-0 right-0 top-0 z-10 m-2 px-2 py-1 rounded bg-badge text-badgeFg text-xs';
      container.appendChild(this.banner);
    }
    this.banner.textContent = `Showing ${this.policy.renderLimit} of ${this.signature.split('\n').length} nodes — open the Tree view for the full list.`;
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
