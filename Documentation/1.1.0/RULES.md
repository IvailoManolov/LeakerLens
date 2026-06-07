# LeakLens v1.1.0 — Rule Catalogue

The detection ruleset is **unchanged from v1.0.0** — the Secret Graph is a new
*visualization* of the same findings, not a detection change. See the full catalogue,
severity scale, precision gates, inline-ignore, and remediation details in:

➡️ [v1.0.0 RULES.md](../1.0.0/RULES.md)

## Note relevant to 1.1.0

Each `Finding` now also carries a **`fingerprint`** — a non-reversible hash of the raw
matched value. It exists purely so the Secret Graph can tell whether two findings are the
same secret; it does not affect detection, severity, or remediation.

## Known precision follow-up

The `dotenv-value-leak` rule (`UPPER_SNAKE = "…"`) can occasionally fire on long
high-entropy *config* constants that aren't secrets (e.g. glob patterns). Tightening this
heuristic is tracked as a follow-up. Until then, the inline `// leaklens:ignore` marker or
the **Ignore here** quick-fix suppresses any false positive on a line.
