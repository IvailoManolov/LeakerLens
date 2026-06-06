/**
 * LeakLens findings panel — webview client.
 *
 * Renders {@link PanelState} pushed by the host and emits {@link PanelToHost} action
 * events. It contains zero detection logic and makes no network calls (CSP forbids it).
 * Styling is Tailwind utilities that resolve to VS Code theme variables, so the panel is
 * automatically correct in light, dark, and high-contrast themes.
 */
import type {
  HostToPanel,
  PanelFinding,
  PanelState,
  PanelToHost,
  RemediationKind,
  Severity,
} from '../extension/panel/protocol';

interface VsCodeApi {
  postMessage(message: PanelToHost): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const root = document.getElementById('app') as HTMLElement;

const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low'];
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function send(message: PanelToHost): void {
  vscode.postMessage(message);
}

function header(scanning: boolean): string {
  const status = scanning
    ? '<span class="text-muted">Scanning…</span>'
    : '<button data-action="rescan" class="px-2 py-1 rounded bg-btnSecondary text-btnSecondaryFg hover:bg-hover">Rescan</button>';
  return `
    <header class="flex items-center justify-between px-3 py-2 border-b border-border">
      <span class="font-medium">LeakLens</span>
      ${status}
    </header>`;
}

function emptyState(): string {
  return `
    <div class="flex flex-1 flex-col items-center justify-center gap-1 text-center px-4">
      <div class="text-ok text-lg">No secrets detected — you're clean ✓</div>
      <div class="text-muted">LeakLens watches your files locally as you type.</div>
    </div>`;
}

function remediationButtons(finding: PanelFinding): string {
  return finding.remediations
    .map(
      (r) =>
        `<button data-action="remediate" data-id="${escapeHtml(finding.id)}" data-kind="${r.kind}" class="text-link hover:underline">${escapeHtml(r.title)}</button>`,
    )
    .join('');
}

function findingRow(finding: PanelFinding): string {
  return `
    <div class="group px-3 py-2 border-l-2 ${SEVERITY_BORDER[finding.severity]} hover:bg-hover">
      <div data-action="jumpTo" data-id="${escapeHtml(finding.id)}" class="cursor-pointer">
        <div class="flex items-center gap-2">
          <span class="${SEVERITY_TEXT[finding.severity]} font-medium">${escapeHtml(finding.ruleName)}</span>
          <span class="text-muted">${escapeHtml(finding.file)}:${finding.line}</span>
        </div>
        <div class="text-muted">${escapeHtml(finding.message)}</div>
        <code class="font-mono text-muted break-all">${escapeHtml(finding.preview)}</code>
      </div>
      <div class="flex gap-3 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        ${remediationButtons(finding)}
      </div>
    </div>`;
}

function severityGroup(severity: Severity, count: number, rows: string): string {
  return `
    <section>
      <div class="flex items-center gap-2 px-3 py-1 text-muted uppercase tracking-wide text-xs">
        <span class="${SEVERITY_TEXT[severity]}">${SEVERITY_LABEL[severity]}</span>
        <span class="px-1.5 rounded bg-badge text-badgeFg">${count}</span>
      </div>
      ${rows}
    </section>`;
}

function render(state: PanelState): void {
  if (state.isEmpty) {
    root.innerHTML = `${header(state.scanning)}${emptyState()}`;
    return;
  }
  const bySeverity = new Map<Severity, PanelFinding[]>();
  for (const group of state.groups) {
    bySeverity.set(group.severity, [...group.items]);
  }
  const sections = SEVERITY_ORDER.filter((s) => bySeverity.has(s))
    .map((s) => {
      const items = bySeverity.get(s) ?? [];
      const rows = items.map(findingRow).join('');
      return severityGroup(s, items.length, rows);
    })
    .join('');
  root.innerHTML = `${header(state.scanning)}<div class="flex-1 overflow-auto divide-y divide-border">${sections}</div>`;
}

function findActionTarget(start: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = start;
  while (el && el !== root) {
    if (el.dataset.action) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

root.addEventListener('click', (event) => {
  const target = findActionTarget(event.target as HTMLElement);
  if (!target) {
    return;
  }
  const action = target.dataset.action;
  if (action === 'rescan') {
    send({ type: 'rescan' });
  } else if (action === 'jumpTo') {
    send({ type: 'jumpTo', id: target.dataset.id ?? '' });
  } else if (action === 'remediate') {
    send({ type: 'remediate', id: target.dataset.id ?? '', kind: target.dataset.kind as RemediationKind });
  }
});

window.addEventListener('message', (event: MessageEvent<HostToPanel>) => {
  const message = event.data;
  if (message.type === 'state') {
    render(message.payload);
  }
});

// Tell the host we're mounted and ready for the first state push.
send({ type: 'ready' });
