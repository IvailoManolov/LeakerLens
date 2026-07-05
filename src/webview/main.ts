/**
 * LeakLens findings panel — webview client.
 *
 * Two views over the same data:
 *  - **List**: findings grouped by severity (the v1.0 view).
 *  - **Tree**: every unique secret → the files → the exact lines it's referenced from.
 *
 * Toggling and searching are handled entirely client-side (no host round-trip), so they
 * are instant. The tree renders children lazily — a collapsed tree is O(distinct secrets)
 * — so it stays smooth on a workspace with hundreds of references. Styling is Tailwind
 * mapped to VS Code theme variables; there is no detection logic and no network here.
 */
import type {
  HostToPanel,
  Locator,
  PanelFinding,
  PanelState,
  PanelToHost,
  PanelView,
  RemediationKind,
  Severity,
  TreeFileNode,
  TreeOccurrence,
  TreeSecretNode,
} from '../extension/panel/protocol';
import { createSecretMap, type SecretMapController } from './secretMap';

interface VsCodeApi {
  postMessage(message: PanelToHost): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const root = document.getElementById('app') as HTMLElement;

const SEVERITY_TEXT: Record<Severity, string> = {
  critical: 'text-critical',
  high: 'text-high',
  medium: 'text-medium',
  low: 'text-low',
};
const SEVERITY_BORDER: Record<Severity, string> = {
  critical: 'border-critical',
  high: 'border-high',
  medium: 'border-medium',
  low: 'border-low',
};
const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

// ── client state ────────────────────────────────────────────────────────────
let state: PanelState | null = null;
let view: PanelView = 'list';
let query = '';
const expanded = new Set<string>();
let secretMap: SecretMapController | null = null;
let mapMounted = false;

interface Persisted {
  view?: PanelView;
  expanded?: string[];
}
const saved = vscode.getState() as Persisted | undefined;
if (saved) {
  if (saved.view) {
    view = saved.view;
  }
  for (const key of saved.expanded ?? []) {
    expanded.add(key);
  }
}

function persist(): void {
  vscode.setState({ view, expanded: [...expanded] } satisfies Persisted);
}

function send(message: PanelToHost): void {
  vscode.postMessage(message);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** In-memory key for the expand/collapse set (never serialized into the DOM). */
const fileKey = (fingerprint: string, file: string): string => `${fingerprint}|${file}`;

/** Render a location as separate, HTML-safe data attributes (no fragile delimiter). */
const locAttrs = (loc: Locator): string =>
  `data-uri="${escapeHtml(loc.uri)}" data-start="${loc.start}" data-end="${loc.end}"`;

/** Read a location back from an element's data attributes. */
const readLoc = (el: HTMLElement): Locator => ({
  uri: el.dataset.uri ?? '',
  start: Number(el.dataset.start),
  end: Number(el.dataset.end),
});

// ── header ──────────────────────────────────────────────────────────────────
function headerHtml(): string {
  const tab = (target: PanelView, label: string): string => {
    const active = view === target;
    const cls = active ? 'bg-active text-fg' : 'text-muted hover:bg-hover';
    return `<button data-action="view" data-view="${target}" class="px-2 py-0.5 ${cls}">${label}</button>`;
  };
  const search =
    view === 'tree' && state && !state.isEmpty
      ? `<input data-role="search" type="text" placeholder="Filter secrets…" value="${escapeHtml(query)}"
           class="w-full mt-2 px-2 py-1 rounded bg-bg border border-border text-fg placeholder:text-muted outline-none" />`
      : '';
  return `
    <header class="px-3 py-2 border-b border-border">
      <div class="flex items-center justify-between gap-2">
        <span class="font-medium">LeakLens</span>
        <div class="flex items-center gap-2">
          <div class="inline-flex rounded overflow-hidden border border-border">
            ${tab('list', 'List')}${tab('tree', 'Tree')}${tab('map', 'Map')}
          </div>
          <button data-action="rescan" class="px-2 py-1 rounded bg-btnSecondary text-btnSecondaryFg hover:bg-hover">Rescan</button>
        </div>
      </div>
      ${search}
    </header>`;
}

// ── empty state ───────────────────────────────────────────────────────────────
function emptyStateHtml(): string {
  return `
    <div class="flex flex-1 flex-col items-center justify-center gap-1 text-center px-4">
      <div class="text-ok text-lg">No secrets detected — you're clean ✓</div>
      <div class="text-muted">LeakLens watches your files locally as you type.</div>
    </div>`;
}

// ── list view (by severity) ─────────────────────────────────────────────────
function remediationButtons(finding: PanelFinding): string {
  return finding.remediations
    .map(
      (r) =>
        `<button data-action="remediate" ${locAttrs(finding.loc)} data-kind="${r.kind}" class="text-link hover:underline">${escapeHtml(r.title)}</button>`,
    )
    .join('');
}

function findingRow(finding: PanelFinding): string {
  // Safe findings (gitignored .env) get a green left border and green rule-name text instead
  // of the severity-colour pair. They also carry no remediations (the host sends none — a
  // secret that's where it belongs has nothing to mask, move, or ignore), so the action row
  // is omitted entirely rather than rendered empty.
  const borderCls = finding.safe ? 'border-ok' : SEVERITY_BORDER[finding.severity];
  const textCls = finding.safe ? 'text-ok' : SEVERITY_TEXT[finding.severity];
  const actions =
    finding.remediations.length > 0
      ? `<div class="flex gap-3 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        ${remediationButtons(finding)}
      </div>`
      : '';
  return `
    <div class="group px-3 py-2 border-l-2 ${borderCls} hover:bg-hover">
      <div data-action="jumpTo" ${locAttrs(finding.loc)} class="cursor-pointer">
        <div class="flex items-center gap-2">
          <span class="${textCls} font-medium">${escapeHtml(finding.ruleName)}</span>
          <span class="text-muted">${escapeHtml(finding.file)}:${finding.line}</span>
        </div>
        <div class="text-muted">${escapeHtml(finding.message)}</div>
        <code class="font-mono text-muted break-all">${escapeHtml(finding.preview)}</code>
      </div>
      ${actions}
    </div>`;
}

function listHtml(s: PanelState): string {
  const sections = s.groups
    .map((group) => {
      const rows = group.items.map(findingRow).join('');
      return `
        <section>
          <div class="flex items-center gap-2 px-3 py-1 text-muted uppercase tracking-wide text-xs">
            <span class="${SEVERITY_TEXT[group.severity]}">${SEVERITY_LABEL[group.severity]}</span>
            <span class="px-1.5 rounded bg-badge text-badgeFg">${group.count}</span>
          </div>
          ${rows}
        </section>`;
    })
    .join('');

  // Safe section: secrets that only live in gitignored .env files. They are shown in
  // green and deliberately excluded from the red leak count — they are where they belong.
  // Rendered FIRST so the "these are safe" confirmation is immediately visible rather than
  // buried beneath the red/yellow problem groups.
  let safeSection = '';
  if (s.safeGroup && s.safeGroup.count > 0) {
    const rows = s.safeGroup.items.map(findingRow).join('');
    safeSection = `
      <section>
        <div class="flex items-center gap-2 px-3 py-1 text-muted uppercase tracking-wide text-xs">
          <span class="text-ok">Safe — in .env (gitignored)</span>
          <span class="px-1.5 rounded bg-badge text-badgeFg">${s.safeGroup.count}</span>
        </div>
        ${rows}
      </section>`;
  }

  return `<div class="divide-y divide-border">${safeSection}${sections}</div>`;
}

// ── tree view (by secret → file → line) ───────────────────────────────────────
const dot = (severity: Severity): string =>
  `<span class="${SEVERITY_TEXT[severity]}">●</span>`;
const badge = (n: number, label: string): string =>
  `<span class="px-1.5 rounded bg-badge text-badgeFg text-xs" title="${label}">${n}</span>`;

/** A standalone expand/collapse control. Clicking it toggles only — it never opens a file. */
function chevronToggle(open: boolean, fingerprint: string, file?: string): string {
  const fileAttr = file === undefined ? '' : ` data-file="${escapeHtml(file)}"`;
  return `<span data-action="toggle" data-fp="${escapeHtml(fingerprint)}"${fileAttr}
    class="w-4 inline-flex justify-center text-muted hover:text-fg" title="Expand / collapse">${open ? '▾' : '▸'}</span>`;
}

function occurrenceRow(o: TreeOccurrence): string {
  return `
    <div data-action="jumpTo" ${locAttrs(o.loc)}
         class="flex items-center gap-2 pl-10 pr-3 py-0.5 cursor-pointer hover:bg-hover text-muted">
      <span class="font-mono">${o.line}:${o.column}</span>
    </div>`;
}

function fileNodeHtml(fingerprint: string, f: TreeFileNode, forceOpen: boolean): string {
  const open = forceOpen || expanded.has(fileKey(fingerprint, f.file));
  const children = open ? f.occurrences.map(occurrenceRow).join('') : '';
  // Clicking the row opens the file at its first occurrence; the chevron expands.
  return `
    <div>
      <div data-action="open" ${locAttrs(f.occurrences[0].loc)}
           data-fp="${escapeHtml(fingerprint)}" data-file="${escapeHtml(f.file)}"
           class="flex items-center gap-2 pl-7 pr-3 py-1 cursor-pointer hover:bg-hover" title="Open file">
        ${chevronToggle(open, fingerprint, f.file)}
        <span class="truncate">${escapeHtml(f.file)}</span>
        ${badge(f.count, 'references in this file')}
      </div>
      ${children}
    </div>`;
}

function secretNodeHtml(s: TreeSecretNode, forceOpen: boolean): string {
  const open = forceOpen || expanded.has(s.fingerprint);
  const children = open ? s.files.map((f) => fileNodeHtml(s.fingerprint, f, forceOpen)).join('') : '';

  // Safe secrets (gitignored .env) use green styling throughout; all other behaviour is
  // identical — they are still clickable, expandable, and jump to their real location.
  const borderCls = s.safe ? 'border-ok' : SEVERITY_BORDER[s.severity];
  const textCls = s.safe ? 'text-ok' : SEVERITY_TEXT[s.severity];
  const dotEl = s.safe ? `<span class="text-ok">●</span>` : dot(s.severity);

  // Clicking the row jumps to the first place this secret appears; the chevron expands.
  return `
    <div class="border-l-2 ${borderCls}">
      <div data-action="open" ${locAttrs(s.files[0].occurrences[0].loc)}
           data-fp="${escapeHtml(s.fingerprint)}"
           class="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-hover" title="Open first reference">
        ${chevronToggle(open, s.fingerprint)}
        ${dotEl}
        <span class="${textCls} font-medium">${escapeHtml(s.ruleName)}</span>
        <code class="font-mono text-muted break-all flex-1 truncate">${escapeHtml(s.preview)}</code>
        ${badge(s.totalCount, 'total references')}
        ${badge(s.fileCount, 'files')}
      </div>
      ${children}
    </div>`;
}

function filterSecrets(secrets: readonly TreeSecretNode[], q: string): TreeSecretNode[] {
  if (q.length === 0) {
    return [...secrets];
  }
  const lower = q.toLowerCase();
  return secrets.filter(
    (s) =>
      s.ruleName.toLowerCase().includes(lower) ||
      s.preview.toLowerCase().includes(lower) ||
      s.files.some((f) => f.file.toLowerCase().includes(lower)),
  );
}

function treeHtml(s: PanelState): string {
  const searching = query.length > 0;
  // filterSecrets operates on s.tree.secrets which now includes safe nodes; safe nodes
  // remain searchable by rule name, preview, and file path — no special handling needed.
  const secrets = filterSecrets(s.tree.secrets, query);
  if (secrets.length === 0) {
    return `<div class=”px-3 py-4 text-muted”>No secrets match “${escapeHtml(query)}”.</div>`;
  }

  // Base summary: problem secrets and refs only.
  const summaryText = `${s.tree.totalSecrets} secret(s) · ${s.tree.totalRefs} reference(s)`;
  // Append safe counts when present, rendered in green so they're clearly distinct.
  const safeSecrets = s.tree.safeSecrets ?? 0;
  const safeRefs = s.tree.safeRefs ?? 0;
  const safeSuffix =
    safeSecrets > 0
      ? ` · <span class=”text-ok”>+${safeSecrets} safe in .env (${safeRefs} ref(s))</span>`
      : '';

  const summary = `<div class=”px-3 py-1 text-xs text-muted”>${summaryText}${safeSuffix}</div>`;
  const nodes = secrets.map((node) => secretNodeHtml(node, searching)).join('');
  return `${summary}<div class=”divide-y divide-border”>${nodes}</div>`;
}

// ── render ────────────────────────────────────────────────────────────────────
function bodyHtml(): string {
  if (!state) {
    return '';
  }
  if (state.isEmpty) {
    return emptyStateHtml();
  }
  if (view === 'map') {
    // Stable mount host; the canvas controller owns everything inside it (see secretMap.ts).
    return '<div id="mapHost" class="relative flex-1 min-h-0"></div>';
  }
  return view === 'tree' ? treeHtml(state) : listHtml(state);
}

function renderHeader(): void {
  const el = document.getElementById('hdr');
  if (el) {
    el.innerHTML = headerHtml();
  }
}

function renderBody(): void {
  const el = document.getElementById('body');
  if (el) {
    el.innerHTML = bodyHtml();
  }
  syncMapLifecycle();
}

/**
 * Mount the Secret Map when its tab is active (and there's data), tear it down otherwise.
 * Because `renderBody` recreates `#mapHost` on every render, `mount()` is idempotent — it
 * re-parents the persistent canvas into the fresh host and preserves the running simulation.
 */
function syncMapLifecycle(): void {
  if (view !== 'map' || !state || state.isEmpty) {
    if (mapMounted) {
      secretMap?.destroy();
      mapMounted = false;
    }
    return;
  }
  const host = document.getElementById('mapHost');
  if (!host) {
    return;
  }
  secretMap ??= createSecretMap(send);
  secretMap.mount(host, state.tree);
  mapMounted = true;
}

function renderAll(): void {
  root.innerHTML = `<div id="hdr"></div><div id="body" class="flex flex-1 flex-col overflow-auto"></div>`;
  renderHeader();
  renderBody();
}

// ── events ────────────────────────────────────────────────────────────────────
function handleClick(event: MouseEvent): void {
  const origin = event.target;
  if (!(origin instanceof Element)) {
    return;
  }
  const target = origin.closest<HTMLElement>('[data-action]');
  if (!target || !root.contains(target)) {
    return;
  }
  const action = target.dataset.action ?? '';
  // Diagnostic ping through the exact webview→host channel we're verifying.
  send({ type: 'log', text: `click action=${action} uri=${target.dataset.uri ?? ''}` });

  switch (action) {
    case 'rescan':
      send({ type: 'rescan' });
      return;
    case 'view': {
      const next = target.dataset.view as PanelView;
      if (next !== view) {
        view = next;
        persist();
        renderHeader();
        renderBody();
      }
      return;
    }
    case 'toggle': {
      const fp = target.dataset.fp ?? '';
      const key = target.dataset.file ? fileKey(fp, target.dataset.file) : fp;
      if (expanded.has(key)) {
        expanded.delete(key);
      } else {
        expanded.add(key);
      }
      persist();
      renderBody();
      return;
    }
    case 'open': {
      // Open the file at this node's first occurrence, and expand the node so its
      // children are revealed. Collapsing is done via the chevron.
      const fp = target.dataset.fp ?? '';
      const key = target.dataset.file ? fileKey(fp, target.dataset.file) : fp;
      expanded.add(key);
      persist();
      send({ type: 'jumpTo', loc: readLoc(target) });
      renderBody();
      return;
    }
    case 'jumpTo':
      send({ type: 'jumpTo', loc: readLoc(target) });
      return;
    case 'remediate':
      send({ type: 'remediate', loc: readLoc(target), kind: target.dataset.kind as RemediationKind });
      return;
  }
}

root.addEventListener('click', (event) => {
  try {
    handleClick(event);
  } catch (err) {
    // A click must never silently die; report it through the host log channel.
    send({ type: 'log', text: `click handler error: ${(err as Error).message}` });
  }
});

// Search is incremental and only re-renders the body, so the input keeps focus.
root.addEventListener('input', (event) => {
  const el = event.target as HTMLElement;
  if (el.dataset.role === 'search') {
    query = (el as HTMLInputElement).value;
    renderBody();
  }
});

window.addEventListener('message', (event: MessageEvent<HostToPanel>) => {
  const message = event.data;
  if (message.type === 'state') {
    state = message.payload;
    renderHeader();
    renderBody();
    if (mapMounted) {
      secretMap?.update(state.tree);
    }
  } else if (message.type === 'setView') {
    view = message.view;
    persist();
    renderHeader();
    renderBody();
  }
});

renderAll();
send({ type: 'ready' });
