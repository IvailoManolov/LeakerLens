# LeakLens v1.0.0 — Project Summary

> A point-in-time summary of what exists at version **1.0.0**. Read this first to
> understand the codebase before diving into [ARCHITECTURE.md](ARCHITECTURE.md) or
> [RULES.md](RULES.md).

## What LeakLens is

A VS Code extension that detects API keys, tokens, passwords, and `.env` secrets **as you
type and before you commit**, with **100% of analysis running locally**. No network calls
in the detection path, no telemetry, no backend.

## What's built in 1.0.0

| Area | Status |
|---|---|
| Pure detection engine (`scanText`) | ✅ Complete, **100% test coverage** |
| Headline ruleset (11 rules) | ✅ AWS, GCP, GitHub, Stripe, OpenAI, Anthropic, Slack, JWT, PEM keys, generic high-entropy, `.env` leaks |
| False-positive gating | ✅ entropy floors, placeholder allowlist, example/test-file context, inline `leaklens:ignore` |
| Inline detection UI | ✅ diagnostics (squiggles), overview-ruler marks, teaching hovers |
| Remediations | ✅ Ignore here / Mask value / Move to `.env` (quick-fix + hover + panel) |
| Findings panel (Tailwind webview) | ✅ severity groups, click-to-jump, inline actions, reassuring empty state |
| Workspace scan command | ✅ |
| Git pre-commit guard | ✅ opt-in, warn-only (blocking is Pro-gated) |
| License / `isPro()` seam | ✅ offline Ed25519 verification (placeholder public key — swap before publishing) |
| Build & packaging | ✅ esbuild bundles + Tailwind CLI + `vsce` → `leaklens-1.0.0.vsix` |

## Code map

```
src/
  engine/      Pure, vscode-free detection. scanText + 11 rules + entropy/mask/allowlist.
  extension/   VS Code glue: scan lifecycle, diagnostics, decorations, hovers, code
               actions, commands, the panel host, and the git hook installer.
  webview/     The Tailwind-styled findings panel client (browser bundle).
  license/     Offline license verification + the single isPro() gate.
test/
  engine/      Vitest unit tests — the 100% coverage gate.
  integration/ @vscode/test-electron smoke tests (activation, diagnostics, quick-fixes).
  perf/        Latency-budget assertion.
```

## How it runs (one paragraph)

On `onStartupFinished`, `activate()` wires document/editor listeners and the hover,
code-action, and panel providers, then scans open editors. Edits trigger a **debounced**
(`~200ms`) scan via `ScanController`, which calls the pure `scanText`, caches `Finding[]`
per document, publishes diagnostics + overview-ruler decorations, and fires an event the
panel listens to. All detection is synchronous, local, and off the typing hot path.

## Test & quality status (1.0.0)

- **Engine:** 46 Vitest tests, **100% lines/branches/functions/statements** on `src/engine/**`.
- **Performance:** a 2k-line file scans well under the 50ms CI ceiling (budget < 10ms).
- **Typecheck:** `tsc --noEmit` clean under `strict`.
- **Integration smoke:** authored and compiles; executes under `@vscode/test-electron`
  (could not launch in the headless build sandbox — run locally with `npm run test:integration`).
- **Bundle sizes:** `extension.js` ~18KB, `webview.js` ~3KB, `webview.css` ~8KB,
  `precommit.js` ~6KB → VSIX well under the 1MB target.

## Known follow-ups (post-1.0.0)

- Replace the placeholder license public key with the real distribution key.
- Optional: ship a polished PNG marketplace icon (currently SVG activity-bar icon only).
- Incremental/worker-based scanning for very large files (current guard skips files > 2MB).
- Pro rule packs, report export (Monetization roadmap).
