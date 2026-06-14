# LeakLens — catch secrets before they leak

**LeakLens** finds API keys, tokens, passwords, and `.env` secrets **as you type and
before you commit** — with **100% of analysis running locally**. Nothing ever leaves your
machine. No account, no cloud, no telemetry of your code.

## Why LeakLens

- **Local-only, always.** Detection never makes a network call. Your code and findings
  stay on your machine — that's the whole point.
- **Zero-config.** Install it and it works. Sensible, quiet defaults; no setup wizard.
- **Fast.** Scanning is debounced and runs off the typing hot path. It won't lag your
  editor.
- **Calm, not alarmist.** Native theming, clear hovers, one-click fixes.

## Features

- Real-time inline detection — squiggles, overview-ruler marks, and teaching hovers.
- One-click remediation: **Ignore here**, **Mask value**, **Move to `.env`** (via the
  lightbulb, the hover, or the panel).
- A calm **Findings panel** grouping detections by severity — click to jump.
- **Secret Graph** — see where each unique secret is referenced from across your workspace,
  two ways from one panel (List · Tree · Map): a **Tree** (`Secret → File → Line`, with counts
  and search) and an animated, force-directed **Map** — secrets as nodes (coloured by
  severity, sized by reference count) linked to the files they appear in; drag, hover, and
  click to jump.
- **Scan Workspace** command for an on-demand sweep.
- Opt-in **git pre-commit guard** that warns (or, with Pro, blocks) on staged secrets.

## Detected secret types

AWS Access Keys, Google/GCP API keys, GitHub tokens, Stripe keys, OpenAI keys, Anthropic
keys, Slack tokens, JWTs, PEM private keys, generic high-entropy secrets, and hardcoded
`.env`-style values. See [`Documentation/1.0.0/RULES.md`](Documentation/1.0.0/RULES.md).

## Commands

| Command | What it does |
|---|---|
| `LeakLens: Scan Workspace for Secrets` | Sweep the whole workspace |
| `LeakLens: Show Findings Panel` | Reveal the panel |
| `LeakLens: Show Secret Graph` | Open the animated map of where each secret is referenced |
| `LeakLens: Install Pre-commit Guard` | Add the opt-in git hook to this repo |
| `LeakLens: Remove Pre-commit Guard` | Remove it |
| `LeakLens: Activate Pro License` | Enter an offline Pro key |

## Free vs Pro

The free tier — real-time detection, the headline ruleset, and manual fixes — is genuinely
useful forever. **Pro** adds commit-blocking policy and (coming) custom rule packs and
report export. Licenses are verified **offline** — a valid key works on a plane.

## Privacy

LeakLens performs **no network requests** for detection and collects **no telemetry** of
your code, secrets, or findings. The only network access the product ever makes is offline
license verification — and that degrades gracefully when offline.

## Inline ignore

Add `leaklens:ignore` anywhere on a line (e.g. `// leaklens:ignore`) to suppress findings
on that line. The **Ignore here** quick-fix does this for you.

## MCP server (for AI coding agents)

LeakLens ships a local **MCP server** so AI coding agents — Claude Code, Cursor, Windsurf —
can call the detection engine directly instead of parsing CLI text. It runs over stdio,
entirely on your machine, with **no network calls**. Start it with `leaklens mcp`.

Register it with your agent (Claude Code, Cursor, Windsurf, …):

```json
{
  "mcpServers": {
    "leaklens": {
      "command": "npx",
      "args": ["leaklens", "mcp"]
    }
  }
}
```

Three tools are exposed:

| Tool | What it does |
|---|---|
| `scan_text` | Scan a snippet of code/text for secrets **before** writing it to disk. |
| `scan_file` | Scan a single file on disk. |
| `scan_workspace` | Sweep the workspace (or given paths), respecting `.gitignore`. |

Each tool returns a short human summary **and** a structured `{ findings, summary }` object,
byte-for-byte consistent with `leaklens scan --json`. **Privacy:** results carry only a
**masked preview** and a non-reversible **fingerprint** of each match — the raw secret is
never returned, not even for `scan_text` where the agent supplied the text.
