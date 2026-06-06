# LeakLens v1.0.0 — Rule Catalogue

The headline ruleset. Each rule is a small, pure object
([`src/engine/types.ts`](../../src/engine/types.ts) → `Rule`) with a regex, an optional
keyword pre-filter, optional entropy/validator gates, a severity, and a masking function.
All rules live in [`src/engine/rules/`](../../src/engine/rules/) and are assembled into
`DEFAULT_RULESET`.

## Severity scale

| Severity | Meaning | VS Code diagnostic |
|---|---|---|
| `critical` | Live credential granting broad access | Error |
| `high` | Sensitive key, often scoped | Error |
| `medium` | Likely secret / context-dependent | Warning |
| `low` | Informational | Information |

## The rules

| # | Rule id | Detects | Severity | Gates |
|---|---|---|---|---|
| 1 | `aws-access-key-id` | `AKIA…`/`ASIA…` + 16 chars | critical | keyword |
| 2 | `gcp-api-key` | `AIza` + 35 url-safe chars | high | keyword |
| 3 | `github-token` | `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_` + 36 | critical | keyword |
| 4 | `stripe-secret-key` | `sk_`/`rk_` + `live`/`test` + body | critical | keyword |
| 5 | `anthropic-api-key` | `sk-ant-…` | critical | keyword |
| 6 | `openai-api-key` | `sk-`/`sk-proj-…` | critical | keyword · entropy ≥ 3.2 · placeholder |
| 7 | `slack-token` | `xoxb`/`xoxa`/`xoxp`/`xoxr`/`xoxs-…` | high | keyword |
| 8 | `jwt` | three base64url segments `eyJ….….…` | medium | keyword |
| 9 | `private-key` | PEM `-----BEGIN … PRIVATE KEY-----` | critical | keyword |
| 10 | `high-entropy-secret` | high-entropy value in a `secret`/`token`/`key`… assignment | medium | keyword · entropy ≥ 3.5 · placeholder |
| 11 | `dotenv-value-leak` | secret value hardcoded against an `UPPER_SNAKE` name | medium | entropy ≥ 3.3 · placeholder · example-path |

> Rule **order matters**: more specific rules come first so that, when two rules match the
> same span, the more specific/severe one wins overlap-dedupe (e.g. an AWS key beats the
> generic high-entropy match; Anthropic beats the broad `sk-` rule).

## Precision gates (why LeakLens is quiet)

False positives are the #1 churn risk, so the default ruleset biases toward **precision
over recall**. Three layers cut noise:

1. **Entropy floor** — a value matching a key shape but with low Shannon entropy (e.g.
   `sk-aaaaaaaaaaaaaaaaaaaa`) is dropped. See
   [`entropy.ts`](../../src/engine/entropy.ts).
2. **Placeholder allowlist** — values containing tokens like `your-`, `example`, `xxxx`,
   `1234`, `changeme`, or a single repeated character are dropped. See
   [`allowlist.ts`](../../src/engine/allowlist.ts).
3. **File context** — the env-leak rule is skipped in `*.example.*`, `*.spec.*`,
   `test/…`, fixtures, and similar paths.

## Inline ignore

Add `leaklens:ignore` anywhere on a line to suppress every finding on that line:

```ts
const legacyKey = "AKIAIOSFODNN7QWERTYZ"; // leaklens:ignore
```

The **Ignore here** quick-fix inserts this for you. Suppression is handled in the pure
engine (`scanText`), so the git hook honours it too.

## Remediations

Each finding offers one-click fixes (via the lightbulb, the hover, or the panel):

| Kind | Effect |
|---|---|
| `ignore` | Append `// leaklens:ignore` to the line |
| `mask` | Replace the secret in-place with `****` of equal length |
| `moveToEnv` | Append the secret to the workspace `.env` and replace it with `process.env.LEAKLENS_SECRET` |

The `private-key` rule offers only `ignore`/`mask` (a PEM block can't be swapped for an
inline env reference).

## Adding a rule (for maintainers)

1. Create `src/engine/rules/<provider>.ts` exporting a `Rule`.
2. Add cheap `keywords` so the regex is skipped when the provider isn't present.
3. Add `entropyFloor` and/or `validate` to keep precision high.
4. Register it in `DEFAULT_RULESET` ([`rules/index.ts`](../../src/engine/rules/index.ts))
   in priority order.
5. Add positive **and** negative fixtures in `test/engine/rules.test.ts` — coverage must
   stay at 100%.
