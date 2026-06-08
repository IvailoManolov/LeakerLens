# Changelog

All notable changes to LeakLens are documented here.

## [1.2.0] — 2026-06-08

### Added

- **Secret Map** — a third Findings-panel view (List · Tree · **Map**) that visualizes the
  workspace's secrets as an animated, force-directed graph: each unique secret is a node
  (coloured by severity, sized by reference count) linked to the files it appears in, so a
  file shared by several secrets stands out at a glance. Drag nodes, hover for details, and
  click to jump to the source. Rendered locally on a `<canvas>` with **zero new dependencies**
  and **nothing leaving the webview** — only the masked preview + fingerprint, never a raw
  secret.
- `LeakLens: Show Secret Graph` now opens the Map.

### Performance

- The map is a pure re-visualization of data the panel already holds; its layout settles and
  then **stops** (no idle CPU), pauses while the panel is hidden, and respects
  `prefers-reduced-motion` (static layout). Very large graphs render a settled layout once and
  **disclose** any node cap rather than truncating silently.

## [1.1.2] — 2026-06-07

### Fixed

- **Panel interactions now work** (open-on-click, Ignore / Mask / Move-to-`.env`, in both
  List and Tree). Root cause: each location id was packed into a string using a NUL (`\0`)
  separator; written into a webview `data-` attribute, the HTML parser replaced NUL with
  U+FFFD (�), corrupting the id so files couldn't be opened and remediations silently
  failed. Locations are now carried as a structured `{uri, start, end}` with no delimiter —
  impossible to corrupt. `remediate()` is also wrapped so any future failure surfaces.

## [1.1.1] — 2026-06-07

### Fixed / hardened

- Panel interactions (open-on-click, Ignore / Mask / Move-to-`.env`) made robust: click
  routing now uses `closest('[data-action]')` and is wrapped so a click can never silently
  die; `jumpTo` failures are surfaced instead of swallowed.
- The findings panel webview now uses `retainContextWhenHidden` so hiding/showing it can't
  desync the message handler.

### Added (diagnostics)

- A **"LeakLens" Output channel** logging panel lifecycle and every webview↔host message,
  to pinpoint any interaction issue without developer tools. (Verbose logging is temporary.)

### Added

- **Secret Graph** — a collapsible tree view (toggle in the Findings panel) that clusters
  findings by the unique secret value and shows every file and line it's referenced from
  (`Secret → File → Line`), with reference/file counts and click-to-jump.
- `LeakLens: Show Secret Graph` command.
- Engine `fingerprint` on each finding (non-reversible hash of the raw value) so identical
  secrets cluster — the raw secret never reaches the UI.
- Tree search box; List ↔ Tree toggle and search are instant (client-side, no round-trip).

### Performance

- Grouping is a single O(findings) pass; the tree renders children lazily, so a collapsed
  tree is O(distinct secrets).

## [1.0.0] — 2026-06-06

Initial release.

### Added

- Pure, local detection engine (`scanText`) with the headline ruleset: AWS, GCP, GitHub,
  Stripe, OpenAI, Anthropic, Slack, JWT, PEM private keys, generic high-entropy secrets,
  and hardcoded `.env` value leaks.
- Real-time inline detection: diagnostics (squiggles), overview-ruler marks, and teaching
  hovers with one-click actions.
- Quick-fix remediations: **Ignore here**, **Mask value**, **Move to `.env`**.
- Tailwind-styled **Findings panel** (theme-aware) grouping detections by severity, with
  click-to-jump and inline actions.
- **Scan Workspace** command.
- Opt-in **git pre-commit guard** (warn-only; commit-blocking gated behind Pro).
- Offline **license/`isPro()`** seam.
- Debounced, incremental, size-guarded scanning to protect typing latency.
- False-positive gating: entropy thresholds, placeholder allowlist, and example/test-file
  context.
