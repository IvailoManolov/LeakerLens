# LeakLens — catch secrets before they leak

**LeakLens** finds API keys, tokens, passwords, and `.env` secrets **as you type and
before you commit** — with **100% of analysis running locally**. Nothing ever leaves your
machine. No account, no cloud, no telemetry of your code.

> **Completely free · local-only · 46 precision-first detectors · catches secrets as you type, in CI, and inside your AI coding agents · zero telemetry.**

LeakLens reaches around your whole workflow from one local engine — **in the editor** (squiggles,
hovers, one-click fixes), **on demand** (Scan Workspace + a List · Tree · Map Findings panel),
**in the terminal and CI** (the `leaklens` CLI with JSON/SARIF output), **inside your AI agents**
(an `leaklens mcp` server), and **before you commit** (an opt-in git guard).

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
- Opt-in **git pre-commit guard** that warns on staged secrets — or blocks the commit, if
  you turn on the `leaklens.commitBlocking` setting.

## Detected secret types

**46 detectors and counting**, all running locally:

- **Cloud & infra** — AWS, Google/GCP, Azure Storage, DigitalOcean, Cloudflare, Heroku, Linode.
- **Source & CI** — GitHub (classic + fine-grained), GitLab, npm, PyPI, Docker Hub, Terraform
  Cloud, Atlassian.
- **AI** — OpenAI, Anthropic, Hugging Face, Replicate, Groq.
- **Payments** — Stripe, Square, Shopify, PayPal / Braintree.
- **Comms & email** — Slack (tokens + webhooks), SendGrid, Mailgun, Mailchimp, Discord webhooks,
  Telegram bots.
- **Observability** — Sentry DSNs, New Relic, Datadog, Grafana, PagerDuty.
- **Datastores** — Postgres / MySQL / MongoDB / Redis connection-string passwords, PlanetScale.
- **Generic** — JWTs, PEM private keys, high-entropy assignments, and hardcoded `.env`-style values.

Detection patterns are partly adapted from [gitleaks](https://github.com/gitleaks/gitleaks) (MIT).
Precision-first: placeholders, example/test files, and low-entropy matches are filtered out so the
signal stays high.

## Commands

| Command | What it does |
|---|---|
| `LeakLens: Scan Workspace for Secrets` | Sweep the whole workspace |
| `LeakLens: Show Findings Panel` | Reveal the panel |
| `LeakLens: Show Secret Graph` | Open the animated map of where each secret is referenced |
| `LeakLens: Set up agent guardrails` | Wire the scanner into your AI agents (MCP + `AGENTS.md` + git hook) |
| `LeakLens: Install Pre-commit Guard` | Add the opt-in git hook to this repo |
| `LeakLens: Remove Pre-commit Guard` | Remove it |

## Completely free

Everything in LeakLens — real-time detection, all 46 detectors, one-click fixes, the
Findings panel, the Secret Graph, the CLI, the MCP server, and the commit-blocking
pre-commit guard — is **free**. No account, no license key, no upsell.

## Privacy

LeakLens performs **no network requests** and collects **no telemetry** of your code,
secrets, or findings. Detection, the CLI, and the MCP server all run entirely on your
machine.

## Inline ignore

Add `leaklens:ignore` anywhere on a line (e.g. `// leaklens:ignore`) to suppress findings
on that line. The **Ignore here** quick-fix does this for you.

## Command-line scanner

LeakLens bundles a headless CLI, so the same engine runs in your terminal and in CI.
Run **`LeakLens: Set up agent guardrails`** once and it provisions a stable copy of the CLI
(surviving extension updates) and writes the exact, ready-to-copy invocation into your
project's `AGENTS.md`:

```sh
node "<path-to-provisioned-cli>" scan src            # human-readable
node "<path-to-provisioned-cli>" scan src --json     # machine-readable JSON
node "<path-to-provisioned-cli>" scan src --sarif    # SARIF 2.1.0 (GitHub code scanning, CI)
```

The exit code is `0` when clean and `1` when secrets are found, so it cleanly gates a CI step or
a pre-push check. It respects `.gitignore` and the same exclusions as the editor, and prints only
masked previews — never the raw secret.

## MCP server (for AI coding agents)

LeakLens bundles a local **MCP server** so AI coding agents — Claude Code, Cursor, VS Code
agent mode — can call the detection engine directly instead of parsing CLI text. It runs
over stdio, entirely on your machine, with **no network calls**.

You don't configure it by hand: run **`LeakLens: Set up agent guardrails`** and LeakLens
registers itself with the agents you pick, writing an entry like this into their MCP config
(`.mcp.json`, `.vscode/mcp.json`, or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "leaklens": {
      "command": "node",
      "args": ["<path-to-provisioned-mcp-server>"]
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
byte-for-byte consistent with the CLI's `--json` output. **Privacy:** results carry only a
**masked preview** and a non-reversible **fingerprint** of each match — the raw secret is
never returned, not even for `scan_text` where the agent supplied the text.

### One-step setup

Run **`LeakLens: Set up agent guardrails`** from the command palette and LeakLens wires itself
into your agents for you: it registers the MCP server (Claude Code, Cursor, VS Code), drops a
short instruction block into `AGENTS.md`, and offers to install the pre-commit guard — no manual
config editing.

## License

LeakLens is **completely free** to install and use. The code is proprietary (no
redistribution) — see [LICENSE](LICENSE). Detection patterns adapted from
[gitleaks](https://github.com/gitleaks/gitleaks) (MIT) are credited in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), which ships with the extension.
