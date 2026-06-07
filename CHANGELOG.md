# Changelog

All notable changes to LeakLens are documented here.

## [1.1.0] — 2026-06-07

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
