# LeakLens v1.0.0 — Architecture

Human-readable guide to how LeakLens works, with diagrams. For the rule catalogue see
[RULES.md](RULES.md); for a high-level status snapshot see [CLAUDE.md](CLAUDE.md).

## 1. The big picture

LeakLens is split into a **pure engine** (no VS Code, fully testable) and a thin **VS Code
glue** layer. The engine is the moat: it's deterministic, synchronous, and reusable (the
git hook runs the very same engine outside the editor).

```mermaid
flowchart TD
  subgraph engine["src/engine/  (pure · vscode-free · 100% tested)"]
    scan["scanText(text, opts) → Finding[]"]
    rules["rules/ (11 detectors)"]
    entropy["entropy.ts"]
    mask["mask.ts"]
    allow["allowlist.ts"]
    scan --> rules
    scan --> entropy
    scan --> allow
    rules --> mask
  end

  subgraph ext["src/extension/  (VS Code glue)"]
    ctrl["ScanController (debounce + cache)"]
    diag["diagnostics"]
    deco["decorations"]
    hov["hovers"]
    ca["codeActions"]
    rem["remediation"]
    cmd["commands"]
    panelHost["panel/panelController (webview host)"]
    git["git/preCommit (installer)"]
  end

  subgraph wv["src/webview/  (Tailwind panel client)"]
    main["main.ts → renders PanelState"]
  end

  vscodeEvents["VS Code events\n(edit / open / activate)"] --> ctrl
  ctrl --> scan
  ctrl --> diag
  ctrl --> deco
  ctrl -- "onDidUpdate" --> panelHost
  panelHost <-- "message protocol" --> main
  hov --> rem
  ca --> rem
  panelHost --> rem
  cmd --> git
  git --> hookRunner["dist/precommit.js\n(bundles engine)"]
```

**Rule (enforced):** nothing in `engine/` imports `vscode`. That single constraint keeps
detection portable, deterministic, and 100%-unit-testable without mocking the editor.

## 2. The scan data-flow (typing → squiggle)

Scanning never runs on the keystroke hot path. Edits are **debounced**; the actual scan is
a pure function call.

```mermaid
sequenceDiagram
  participant U as User (typing)
  participant VS as VS Code
  participant SC as ScanController
  participant E as scanText (engine)
  participant D as Diagnostics / Decorations
  participant P as Panel (webview)

  U->>VS: edit document
  VS->>SC: onDidChangeTextDocument
  SC->>SC: debounce ~200ms (reset timer)
  Note over SC: only after typing settles
  SC->>SC: shouldScan? (enabled · file · ≤ size cap)
  SC->>E: scanText(text, {filename})
  E-->>SC: Finding[] (deduped, non-overlapping)
  SC->>D: publish squiggles + ruler marks
  SC->>P: onDidUpdate → push PanelState
```

Inside `scanText` each rule runs a cheap keyword pre-filter, then its regex, then the
gates that protect precision:

```mermaid
flowchart LR
  A["for each rule"] --> B{keyword present?}
  B -- no --> A
  B -- yes --> C["regex matches"]
  C --> D{entropy ≥ floor?}
  D -- no --> C
  D -- yes --> F{validate ok?\n(placeholder / path)}
  F -- no --> C
  F -- yes --> G["build Finding (mask preview)"]
  G --> H["dedupe overlaps\n(most-severe wins)"]
  H --> I["drop lines with\nleaklens:ignore"]
  I --> J["Finding[]"]
```

## 3. The webview message protocol

The panel is a sandboxed webview (strict CSP, nonce'd script, no network). It knows
nothing about detection — it renders `PanelState` and emits action events. The contract
lives in [`src/extension/panel/protocol.ts`](../../src/extension/panel/protocol.ts).

```mermaid
sequenceDiagram
  participant Host as panelController (host)
  participant WV as main.ts (webview)

  WV->>Host: { type: "ready" }
  Host-->>WV: { type: "state", payload: PanelState }
  Note over WV: render groups by severity\n(or reassuring empty state)
  WV->>Host: { type: "jumpTo", id }          %% open file + reveal range
  WV->>Host: { type: "remediate", id, kind } %% ignore / mask / moveToEnv
  WV->>Host: { type: "rescan" }              %% runs scanWorkspace
  Host-->>WV: { type: "state", … }            %% pushed again on every update
```

`id` encodes `"<uri> <start> <end>"`, so the host can resolve any panel row back to a
precise document range for jumping or remediation.

## 4. Theming (Tailwind → VS Code)

The panel uses Tailwind utilities **only**, and every color/font token resolves to a
`--vscode-*` CSS variable (see [`tailwind.config.js`](../../tailwind.config.js)). The panel
is therefore automatically correct in light, dark, and high-contrast themes — we never
hardcode a color. Inline detection UI (squiggles, ruler marks, hovers) uses the native VS
Code APIs and `ThemeColor`, not Tailwind.

## 5. The git pre-commit guard

Opt-in and entirely local. On install, LeakLens copies the bundled `dist/precommit.js`
into `.git/hooks/leaklens-precommit.cjs` and writes a `pre-commit` shell that runs it. The
runner reads **staged** blobs via `git` and scans them with the same engine.

```mermaid
flowchart LR
  commit["git commit"] --> hook[".git/hooks/pre-commit"]
  hook --> runner["leaklens-precommit.cjs\n(bundled engine)"]
  runner --> staged["git diff --cached\n+ git show :file"]
  staged --> scanText
  scanText --> verdict{secrets found?}
  verdict -- no --> ok["exit 0 ✓"]
  verdict -- "yes · warn-only" --> warn["print + exit 0"]
  verdict -- "yes · blocking" --> block["print + exit 1 ✗"]
```

Commit-blocking is controlled by the `leaklens.commitBlocking` setting; when off, the guard is warn-only.

## 6. Performance budget (treated as law)

| Budget | Target | How it's protected |
|---|---|---|
| Activation | < 50ms of our code | lazy `onStartupFinished`; activate only wires listeners |
| Typical scan (<2k lines) | < 10ms | pure synchronous regex + keyword pre-filter; perf test guards it |
| Typing feel | no perceptible lag | debounced (~200ms), never scans per keystroke |
| Large files | never block UI | files over the size cap (default 2MB) are skipped |
| VSIX size | < 1MB | esbuild minified bundles, purged Tailwind, zero runtime deps |
