# Changelog

All notable changes to LeakLens are documented here.

## [5.0.0] — 2026-07-05

**Milestone release.** LeakLens 5.0 marks the point where the local detection engine reaches
all the way around your workflow — **as you type** (diagnostics, hovers, one-click fixes), **on
demand** (Scan Workspace + the List · Tree · Map Findings panel), **in the terminal and CI**
(the headless `leaklens` CLI with `--json` / `--sarif` and gate-able exit codes), **inside your
AI coding agents** (the `leaklens mcp` stdio server + one-step `Set up agent guardrails`), and
**before you commit** (the opt-in pre-commit guard). All of it runs **100% locally** across
**46 precision-first detectors** — nothing ever leaves your machine.

### Changed

- **LeakLens is now completely free.** The Pro tier is gone: commit-blocking
  (`leaklens.commitBlocking`) works for everyone with no license key, and the
  `LeakLens: Activate Pro License` command and offline license gate have been removed.
  LeakLens now makes **zero** network requests — there is no longer even a license check.
- **Refreshed brand + store presentation.** A new, higher-fidelity marketplace icon (gradient
  brand tile, gradient lens, glass highlight, crisp keyhole — authored as a scalable SVG and
  exported to a 256×256 PNG) and a polished Marketplace/README presentation page.
- **Bundled attribution.** The gitleaks (MIT) pattern attribution now ships inside the
  extension as `THIRD_PARTY_NOTICES.md`.
- Documentation updated to present the full 5.0 surface area (editor · CLI · MCP · agent
  guardrails · pre-commit guard) as one coherent local-only product.

### Compatibility

- **No detection-behavior changes** since 3.1.1 — the engine, the 46 rules, the `.env`/`.gitignore`
  policy, and the scan-latency budget are byte-for-byte unchanged. Upgrading from 3.x is safe and
  requires no configuration changes. The major version marks the milestone, not a breaking change.

## [3.1.1] — 2026-06-21

### Fixed

- **Workspace scan now honors `.gitignore`.** `Scan Workspace` previously reported secrets in
  gitignored, generated directories (e.g. `.next/`, `.terraform/`, custom `reports/`) that the
  hardcoded exclude list didn't cover — `vscode.workspace.findFiles` never reads `.gitignore`, so
  these surfaced as "phantom" leaks the headless `leaklens` CLI already skipped. The scan now
  filters its file list through each workspace folder's `.gitignore`, reusing the CLI's own ignore
  logic for guaranteed parity. Gitignored `.env` files are still scanned and rendered green/"safe".

## [3.1.0] — 2026-06-14

### Added

- **34 new secret detectors (12 → 46 rules).** Broad provider coverage: cloud (Azure,
  DigitalOcean, Cloudflare, Heroku, Linode), source/CI (GitLab, npm, PyPI, Docker Hub, Terraform
  Cloud, Atlassian, GitHub fine-grained), AI (Hugging Face, Replicate, Groq), payments (Square,
  Shopify, PayPal/Braintree), comms (SendGrid, Mailgun, Mailchimp, Slack/Discord webhooks,
  Telegram), observability (Sentry, New Relic, Datadog, Grafana, PagerDuty), and database
  connection-string passwords (Postgres, MySQL, MongoDB, Redis, PlanetScale). Patterns adapted
  from gitleaks (MIT); credited in `src/engine/rules/catalog/CREDITS.md`.
- New rules use a declarative catalog + a shared `defineRule()` factory, so the ruleset grows
  without eroding the 100% engine-coverage gate or the scan-latency budget.

### Changed

- Marketplace readiness: a colour 256×256 PNG icon, a refined proprietary EULA, a corrected
  repository URL, and an updated README (full detector list + a CLI section).

### Quality

- Conservative, precision-first: every new rule is keyword-gated, and loose detectors are gated by
  entropy + placeholder + example-path filters (no `Bearer`/raw-blob catch-alls). Suite at
  **523 tests**, engine still **100%** covered, scan well under the 50 ms budget.

## [3.0.0] — 2026-06-14

### Added — Agent-friendly surfaces

LeakLens is now usable by AI coding agents and CI, not just the editor GUI. The pure
detection engine is exposed through three headless surfaces — everything stays local, and
each surface only ever emits a masked preview + fingerprint, never the raw secret.

- **`leaklens` CLI** — `leaklens scan [globs…]` (and `--stdin`) with human, **`--json`**, and
  **`--sarif`** output plus gate-able exit codes (`0` clean / `1` findings / `2` usage) for CI
  and agent loops. `.gitignore`-aware, honors the `.env` policy, and emits findings in a
  deterministic order so runs and diffs are stable.
- **MCP server** — `leaklens mcp` starts a stdio server exposing `scan_text`, `scan_file`, and
  `scan_workspace`, so an agent can scan code *before* it writes it or audit the workspace on
  demand. The SDK is bundled into its own `dist/mcp.js`, off the hot scan path.
- **`LeakLens: Set up agent guardrails`** command — one step wires the MCP server into your
  agents (Claude Code `.mcp.json`, VS Code `.vscode/mcp.json`, Cursor `.cursor/mcp.json`),
  merges an instruction block into `AGENTS.md`, and offers to install the pre-commit guard.
  Config merges are idempotent, and the runners are copied into the extension's global storage
  so the wiring survives extension updates.

### Internal

- A shared, dependency-free `engine/scope.ts` is now the single source of truth for scan
  exclusions, used by both the editor and the CLI. New runtime dependencies (`ignore`,
  `@modelcontextprotocol/sdk`, `zod`) are esbuild-bundled per surface. Test suite grew to
  **423 tests**; the engine stays at **100%** coverage.

## [2.1.0] — 2026-06-11

### Fixed

- **Green (safe) secrets no longer offer remediations.** A secret living in a gitignored
  `.env` file is already where it belongs, so "Ignore here", "Mask value", and "Move to
  `.env`" made no sense for it. Those actions are now suppressed for safe findings across
  every surface — the Findings panel (List), the editor lightbulb (quick-fixes), and the
  hover links. Red (counted) leaks are unaffected.
- **Safe secrets now render green in the Map.** Tree-mode map nodes use a different id scheme
  (`tsecret:<fp>@<file>`) than force mode (`secret:<fp>`), so the safe set never matched and
  the node fell back to its red severity colour. The safe set is now keyed on the secret's
  fingerprint, so a gitignored-`.env` secret shows green (with its "Safe (.env gitignored)"
  tooltip badge) in both Tree and Force layouts — consistent with the List and Tree views.

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
