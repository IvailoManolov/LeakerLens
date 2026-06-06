# LeakLens — Local Secret Leak Guard for VS Code

> Working codename: **LeakLens**. A VS Code extension that catches API keys, tokens,
> passwords, and `.env` secrets **as you type and before you commit** — with **100% of
> analysis running locally**. Nothing ever leaves the user's machine.

This file is the contract for anyone (human or AI) working in this repo. Read it before
writing code. When a decision isn't covered here, optimize for the **Prime Directive**
and the **Three Inviolable Principles** below.

---

## Prime Directive

Make a developer feel *instantly safer* the moment they install, with **zero
configuration, zero friction, and zero data leaving their machine**. The product wins on
**trust + speed + polish**, not feature count. Every line of code serves that.

## Three Inviolable Principles (never violate without explicit owner sign-off)

1. **LOCAL-ONLY. ALWAYS.** No network calls for detection. No telemetry of code content,
   ever. No "send to cloud to scan." This is the entire marketing moat — a server-based
   competitor *cannot* claim it. If a feature needs the network, it does not ship in the
   detection path. (The *only* permitted network call is offline-verifiable license
   activation — see Monetization — and even that must degrade gracefully offline.)
2. **ZERO MARGINAL COST.** No hosted backend, no per-user compute, no LLM/API inference.
   The business only works because each user costs ≈ €0. Any proposal that adds a runtime
   server cost is rejected by default.
3. **NEVER BLOCK THE EDITOR.** Detection runs on every keystroke-ish event. If it ever
   makes typing feel laggy, we have failed. Hard performance budget below is law.

---

## What it does (scope)

**In scope (the whole product):**
- Real-time, inline detection of secrets as the user types (squiggle + gutter + hover).
- Pre-commit / pre-save guard that warns (and optionally blocks) before secrets are saved
  or committed.
- A curated, regex/entropy-based rule set for high-signal secret types (AWS, GCP, GitHub,
  Stripe, OpenAI/Anthropic keys, JWTs, private keys, generic high-entropy strings, `.env`
  value leaks into source, etc.).
- One-click remediation: ignore (inline annotation), move-to-`.env`, or mask.
- A beautiful, calm "LeakLens panel" summarizing findings for the workspace.

**Explicitly OUT of scope (resist scope creep — these break a principle or the business):**
- ❌ Any AI/LLM-based detection or explanation. (Token burn → kills the cost model.)
- ❌ Cloud dashboards, team servers, org sync via our backend. (Breaks local-only + cost.)
- ❌ Sending code, hashes of code, or findings anywhere off-machine.
- ❌ Full SAST / general-purpose linting. We do ONE thing: secrets.
- ❌ Git history rewriting / remediation of already-pushed secrets (link to docs instead).

---

## Tech stack & architecture

- **Language:** TypeScript, strict mode. No `any` without a written reason.
- **Runtime:** VS Code Extension API. Target the broadest stable `engines.vscode` we can.
- **Build:** `esbuild` for fast bundling (small VSIX, fast activation). No webpack.
- **Zero heavy deps.** Every dependency is a liability (VSIX size, supply-chain risk,
  activation time). Justify each one in `package.json` review. Prefer the platform.
- **Tests:** unit tests for the detection engine (pure, fast, deterministic). The engine
  must be testable with zero VS Code mocking — keep it decoupled.

### Module layout (keep this separation strict)
```
src/
  engine/        # PURE detection logic. No vscode imports. Fully unit-tested.
    rules/       # Rule definitions (patterns, entropy thresholds, validators).
    scan.ts      # scanText(text, opts) -> Finding[]   (synchronous, pure, fast)
    entropy.ts   # Shannon entropy + heuristics to cut false positives.
  extension/     # VS Code glue. Thin. Subscribes to events, renders UI.
    diagnostics  # Inline squiggles via DiagnosticCollection.
    decorations  # Gutter icons / inline decorations.
    panel        # The LeakLens findings webview (see UX rules).
    commands     # Ignore / move-to-env / mask / scan-workspace.
    git          # Pre-commit hook integration (local git hook, opt-in).
  license/       # Offline license-key validation (see Monetization).
```
**Rule:** `engine/` must never import `vscode`. This keeps detection portable, testable,
and reusable (e.g. a future CLI) without dragging the editor in.

### Detection engine design
- `scanText` is **pure and synchronous**: `(text, filename, ruleset) => Finding[]`.
- Each rule = `{ id, name, severity, pattern, entropyFloor?, validate?(match) }`.
- Cut false positives aggressively: entropy gating, allowlists (example/test/placeholder
  values like `xxxx`, `your-key-here`), filename context, and per-rule `validate`.
- **False positives are the #1 churn risk.** A noisy detector gets uninstalled. Bias
  toward precision over recall for the default ruleset; let power users opt into noisier
  rules.
- Debounce per-document scanning (~150–250ms after typing stops). Never scan on every
  character synchronously on the UI path.
- Incremental: re-scan only changed ranges where feasible for large files.

---

## Performance budget (LAW — CI should guard these)

- **Activation:** lazy. Activate on language/file events, not `*`. Cold activation < 50ms
  of our code.
- **Per-scan latency:** a typical file (< 2k lines) scans in **< 10ms**. A large file
  (10k+ lines) must never block the UI thread — chunk or move to a worker.
- **Typing feel:** zero perceptible input lag. If profiling shows our handlers on the hot
  path adding > 1 frame (~16ms), fix it before merging.
- **VSIX size:** keep small (target < 1MB). Bloat = slow install = lost trust.

---

## UX — "extremely easy and beautiful" (this is a feature, not decoration)

The owner's explicit bar: **easy + beautiful.** UX bugs are P1 bugs. Principles:

1. **Zero-config wow.** It works perfectly the second it's installed. No setup wizard, no
   "configure your rules first." Sensible, quiet defaults.
2. **Calm, not alarmist.** Findings are clear but not panic-inducing. Use VS Code's native
   theming tokens — never hardcode colors. Look *native*, respect light/dark/high-contrast.
   The extension should feel like it ships with the editor.
3. **The 5-second demo must be flawless.** Type an AWS key → it lights up red, instantly,
   with a clean hover explaining what it is and a one-click fix. This single interaction is
   the entire marketing GIF. Polish it obsessively. It is the most important UI in the app.
4. **Hovers teach, don't lecture.** Short: what was found, why it's risky, the one action.
   Markdown, tasteful, scannable. No walls of text.
5. **One-click remediation, always reachable.** Quick Fix (lightbulb) + hover action:
   *Ignore here* / *Move to .env* / *Mask*. Make the safe path the easy path.
6. **The LeakLens panel** (if/when built) is a calm summary: grouped by severity, click to
   jump, empty-state that feels reassuring ("No secrets detected — you're clean ✓"), not
   blank. Use a webview only if native tree/views can't deliver the polish; prefer native.
7. **Iconography & microcopy matter.** One consistent, crisp icon. Human, confident copy.
   No jargon, no fear-mongering, no growth-hacky nags.
8. **Respect the user.** Never modify files without explicit action. Ignore decisions
   persist (inline `// leaklens:ignore` style or workspace config). No surprise blocking
   unless the user opted into commit-blocking.

When in doubt on UX: **fewer surfaces, more polish.** A beautiful, tiny product beats a
cluttered powerful one for this audience.

---

## Monetization (build the seams in early, don't bolt on later)

- **Model:** Free tier + **Pro license**, license key validated **locally/offline**
  (signed key verified with a bundled public key). No account required to use the product.
- **Payments:** Lemon Squeezy or Polar as merchant-of-record (they handle EU VAT MOSS —
  important, owner is EU-based). We never store card data or run a billing server.
- **Free vs Pro split (provisional — keep the door open in code):**
  - Free: core real-time detection, the headline rule set, manual fixes. Genuinely useful
    forever — the free tier IS the marketing.
  - Pro: custom org rule sets, commit-blocking policy, bulk workspace scan + report export,
    advanced rule packs, priority. (Finalize later; just don't hardcode "everything free.")
- **Gating must be clean:** a single `license.isPro()` check; Pro features degrade to a
  tasteful upsell, never a broken state. Never nag free users aggressively.
- **Activation degrades gracefully offline** — a valid key works on a plane. (Principle 1.)

## Distribution ("build once, deploy everywhere")

- Publish to **BOTH** the VS Code Marketplace **and** Open VSX. Open VSX = Cursor,
  Windsurf, VSCodium users (a large, underserved, fast-growing audience). One build, two
  registries. CI should publish to both.
- Keep `engines.vscode` permissive enough to run in forks.

---

## Definition of Done (every change)

- Detection logic has unit tests; engine stays `vscode`-free and deterministic.
- No new network calls in the detection path. No telemetry of code content.
- Performance budget respected (no UI-thread blocking; debounced).
- UX reviewed against the bar above (native theming, calm, one-click fix works).
- Works in a clean install with zero config.

## Anti-goals / things that will get a PR rejected

- Adding an LLM, a backend, or any "scan in the cloud" path.
- Shipping a noisy ruleset that floods users with false positives.
- Blocking or lagging the editor.
- Telemetry that captures code, secrets, or findings content.
- Feature creep beyond "detect & remediate secrets, locally."
- Ugly, off-theme, or alarmist UI.

---

## Current status / next step

Pre-code. **Validate before building:** a mockup GIF + a Lemon Squeezy waitlist page posted
to r/vscode, r/webdev, and X. Target ~50 signups / strong engagement in 2 weeks before
committing real build time. Build follows demand.
