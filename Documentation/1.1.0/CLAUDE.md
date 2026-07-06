# LeakLens v1.1.0 — Project Summary

> Point-in-time summary at version **1.1.0**. Builds on
> [v1.0.0](../1.0.0/CLAUDE.md); this doc covers what changed. See
> [ARCHITECTURE.md](ARCHITECTURE.md) for the new feature's design.

## What's new in 1.1.0 — the Secret Graph

A **collapsible tree view** that answers *"where is this secret referenced from?"*. It
clusters every finding by the **unique secret value** and shows the blast radius:

```
Secret (key)  →  File  →  Line:Col
```

- **List ↔ Tree toggle** lives in the existing Findings panel header (one surface).
- The tree groups by an engine-computed **fingerprint** of the raw value, so identical
  secrets across files collapse into a single node with a reference count + file count.
- **Privacy preserved:** the raw secret never leaves the host — only the fingerprint and
  the masked preview travel to the webview.
- **Search box** filters secrets by rule, masked preview, or file path.
- **Click a line → jump** to it (reuses the v1.0 jump id format).
- `LeakLens: Show Secret Graph` command runs a workspace scan, reveals the panel, and
  switches to the tree.

## Performance

- Grouping is a single **O(F)** pass (F = number of findings) using two `Map`s, host-side.
- The tree renders children **lazily** — a collapsed tree is **O(distinct secrets)** — so
  it stays instant even with hundreds of references.
- Toggling List↔Tree and searching are **client-side only** (no host round-trip).

## What changed in the code

| File | Change |
|---|---|
| [src/engine/fingerprint.ts](../../src/engine/fingerprint.ts) | **New.** Pure cyrb53 hash (`fingerprint(value)`), no crypto import. |
| [src/engine/types.ts](../../src/engine/types.ts) | `Finding` gains `fingerprint: string`. |
| [src/engine/scan.ts](../../src/engine/scan.ts) | Sets `fingerprint` on each finding. |
| [src/extension/panel/protocol.ts](../../src/extension/panel/protocol.ts) | `PanelView`, `Tree*` types, `PanelState.tree`, `HostToPanel.setView`. |
| [src/extension/panel/panelController.ts](../../src/extension/panel/panelController.ts) | `buildTree()` (O(F) grouping) + `setView()`. |
| [src/extension/commands.ts](../../src/extension/commands.ts) | `leaklens.showSecretGraph` command. |
| [src/webview/main.ts](../../src/webview/main.ts) | List/Tree toggle, lazy collapsible tree, search, persisted view/expand state. |

## Quality status (1.1.0)

- **Engine:** 52 Vitest tests, **100% coverage** on `src/engine/**` (incl. `fingerprint.ts`).
- **Typecheck:** `tsc --noEmit` clean under `strict`.
- **Bundles:** extension ~20KB · webview ~6.4KB · webview.css ~8.8KB · precommit ~6.4KB →
  VSIX well under the 1MB budget.
- **Integration smoke:** adds a `showSecretGraph` registration/run check (runs headless in CI).

## Known follow-ups

- The `dotenv-value-leak` rule can false-positive on long `UPPER_SNAKE = "…"` config
  constants (e.g. glob strings). Consider tightening its heuristic.
- Carried over from 1.0.0: marketplace PNG icon, worker-based scanning for very large files.
