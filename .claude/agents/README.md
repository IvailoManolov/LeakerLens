# LeakLens build team — subagents

This directory defines the **Claude Code subagent team** that builds **LeakLens**, the local-only
secret-leak guard for VS Code described in [`../../vscode-extension-leaker.md`](../../vscode-extension-leaker.md).

Each agent is a single markdown file with YAML frontmatter (`name`, `description`, `tools`, `model`)
and a system-prompt body. Claude Code auto-discovers them; list them with `/agents`.

## The team

| Agent | Role | Owns | Tools | Model |
|-------|------|------|-------|-------|
| [`planner`](planner.md) | Architect | Build sequencing + interface contracts; produces task breakdowns | read-only (`Read, Grep, Glob`) | opus |
| [`backend-engineer`](backend-engineer.md) | Logic | `engine/`, `extension/` glue, build tooling, webview **host** | edit + `Bash` | opus |
| [`frontend-engineer`](frontend-engineer.md) | UI | **Only** the Tailwind panel webview (HTML/CSS/styling) | edit + `Bash` | sonnet |
| [`test-engineer`](test-engineer.md) | Tests | All tests; 100% on `engine/`, smoke tests on glue, perf guards | edit + `Bash` | sonnet |

## Orchestration model (important)

**Subagents cannot invoke other subagents in Claude Code.** Only the **main Claude thread** (or a
Workflow script) can dispatch work to subagents. So the `planner` does **not** drive the other three —
it produces a plan, and the **main thread reads that plan and dispatches** each task to the right agent.

```
                ┌─────────────┐
   you ───────▶ │ main thread │ ◀──── dispatches tasks
                └──────┬──────┘
                       │ 1. ask planner for the breakdown
                       ▼
                 ┌───────────┐
                 │  planner  │  (read-only: plans + freezes contracts)
                 └─────┬─────┘
                       │ returns ordered task list
                       ▼
        ┌──────────────┼───────────────┐
        ▼              ▼                ▼
 ┌────────────┐ ┌──────────────┐ ┌──────────────┐
 │  backend   │ │  frontend    │ │     test     │
 │  engineer  │ │  engineer    │ │   engineer   │
 └────────────┘ └──────────────┘ └──────────────┘
   (run backend ∥ frontend where the contract allows;
    test-engineer follows the code it covers)
```

### Typical flow
1. **Plan** — dispatch to `planner`: it reads the spec, freezes contracts, returns an ordered,
   dependency-tagged task list (`[backend]` / `[frontend]` / `[test]`).
2. **Build (parallel where allowed)** — dispatch the engine/glue tasks to `backend-engineer`; once the
   webview message protocol is frozen, dispatch the panel to `frontend-engineer` in parallel.
3. **Test** — dispatch to `test-engineer` to drive `engine/` to 100% coverage and add glue smoke +
   performance tests.

## Shared contracts (the seams the planner owns and freezes)

These two contracts are how the agents stay decoupled. The `planner` defines them; everyone else
depends on them verbatim.

1. **`Finding` type** — what `engine/scanText(text, filename, ruleset): Finding[]` returns
   (rule id, severity, range/offsets, masked preview, available remediations).
   Consumed by `extension/` and by every engine test.
2. **Webview message protocol** — extension→panel data payload (findings grouped by severity, counts,
   empty-state flag) and panel→extension action events (`jumpTo`, `ignore`, `moveToEnv`, `mask`).
   The `backend-engineer` implements the host side; the `frontend-engineer` consumes it.

## Non-negotiable constraints baked into every agent

Inherited from the spec — see [`../../vscode-extension-leaker.md`](../../vscode-extension-leaker.md):

- **Local-only, always** — no network in the detection path, no telemetry of code content.
- **Zero marginal cost** — no backend, no per-user compute, no LLM/API inference.
- **Never block the editor** — debounce 150–250ms, chunk/offload large files; activation < 50ms,
  typical scan < 10ms.
- **TypeScript strict everywhere**, no `any` without a written reason.
- **`engine/` never imports `vscode`** — pure, deterministic, portable, 100%-testable.
- **Tailwind only in the panel webview**, mapped to `--vscode-*` theme variables (native in light/
  dark/high-contrast). Inline detection UI stays native VS Code API.
- **Documentation is part of every task's Definition of Done** (TSDoc on exports + README updates).

## How to use

- Run `/agents` to confirm all four are discovered.
- Start a build turn with: *"Use the planner to produce the build order for the engine, then dispatch."*
- The main thread will fan work out to `backend-engineer` / `frontend-engineer` / `test-engineer`
  according to the plan, keeping each inside its scope fence.
