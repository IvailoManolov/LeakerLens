# LeakerLens v1.2.0 — Project Summary

> Point-in-time summary at version **1.2.0**. Builds on
> [v1.1.0](../1.1.0/CLAUDE.md) (the Secret Graph) and [v1.0.0](../1.0.0/CLAUDE.md); this doc
> covers what changed.

## What's new in 1.2.0 — the Secret Map

A **third Findings-panel view** (header toggle: **List · Tree · Map**) that visualizes the
workspace's secrets as an **animated, force-directed graph** — the flashy, demo-able sibling
of the Tree:

```
   src/a.ts ──┐
              ●  AWS Access Key ID   (critical · 4 refs · 2 files)
   src/b.ts ──┘
```

- **Bipartite graph:** each unique secret is a node (coloured by severity, radius ∝ √refs)
  linked to every file it occurs in. A file referenced by several secrets is a **single
  shared node** — its higher degree makes "this file holds multiple secrets" obvious.
- **Interactive:** drag to reposition, hover for a themed tooltip (rule / masked preview /
  counts), click a node to **jump** to the source (reuses the v1.0 `jumpTo` channel).
- **`LeakerLens: Show Secret Graph` now opens the Map.** The Tree is retained (its search box
  and DOM list remain the accessible, searchable equivalent).
- **Privacy preserved:** like the Tree, only the **masked preview + fingerprint + counts**
  reach the webview — the raw secret never does.

## Where the code lives

| File | Change |
|---|---|
| [src/engine/secretMapModel.ts](../../src/engine/secretMapModel.ts) | **New.** Pure, DOM-free, vscode-free graph build + force-layout math (`buildGraphModel`, `forceStep`, `nodeRadius`, `capForNodeCount`, `severityColorVars`, `seedPosition`). |
| [src/webview/secretMap.ts](../../src/webview/secretMap.ts) | **New.** The `<canvas>` controller (`createSecretMap → mount/update/destroy`): render loop, interaction, theme/resize/visibility lifecycle. |
| [src/webview/main.ts](../../src/webview/main.ts) | `Map` tab, `'map'` body branch, and `syncMapLifecycle()` mount/teardown. |
| [src/extension/panel/protocol.ts](../../src/extension/panel/protocol.ts) | `PanelView` widened to `'list' \| 'tree' \| 'map'` (no new host→panel data — the Map re-visualizes the existing `TreeState`). |
| [src/extension/commands.ts](../../src/extension/commands.ts) | `showSecretGraph` now calls `setView('map')`. |

## Two design decisions worth knowing

1. **The layout math is in the engine on purpose.** It's pure/deterministic/dependency-free,
   so it sits beside `fingerprint.ts`/`entropy.ts` and lands under the existing **100%
   coverage gate** with no test-config churn. It is *not* imported by `scan`/`hookRunner`, so
   esbuild tree-shakes it out of `precommit.js`/`extension.js` (it only bundles into
   `webview.js`). Layouts are seeded by node **index** (a phyllotaxis spiral) — no
   `Math.random`, so the engine stays deterministic and unit-testable.
2. **The canvas survives `innerHTML` re-renders.** `main.ts` recreates `#mapHost` on every
   render, so `mount()` is idempotent: it re-parents the persistent canvas into the fresh host
   and **preserves the live simulation**. The rAF loop **settles then stops** (zero idle CPU),
   pauses on `visibilitychange`, and is fully torn down by `destroy()` on tab switch.

## Performance & constraints (unchanged guarantees)

- **Local-only / zero-cost:** a pure client-side re-visualization — no network, no detection
  in the webview.
- **Zero runtime deps**, hand-rolled on `<canvas>`. Bundle stays tiny (`webview.js` ~20KB
  minified; VSIX well under the 1MB budget).
- **Strict CSP** preserved (no inline styles; theme colours resolved from `--vscode-*` via
  `getComputedStyle`, re-resolved on theme change). Correct in light/dark/high-contrast.
- **Calm:** respects `prefers-reduced-motion` (static settled layout); large graphs render a
  settled layout once and **disclose** any node cap (never silent truncation).

## Quality status (1.2.0)

- **Engine:** 74 Vitest tests (+22 for `secretMapModel`), **100% coverage** on `src/engine/**`.
- **Typecheck:** `tsc --noEmit` clean under `strict`.
- **Bundles:** extension ~21KB · webview ~20KB · webview.css ~9KB · precommit ~6.3KB
  (unchanged — confirms the model tree-shakes out of the hook).

## Known follow-ups

- Map enhancements deferred from v1.2.0: zoom/pan, focus/highlight-neighbours, edge-flow
  animation, a severity legend.
- Carried over: marketplace PNG icon, the `dotenv-value-leak` false-positive on long
  `UPPER_SNAKE` config constants, worker-based scanning for huge files.
