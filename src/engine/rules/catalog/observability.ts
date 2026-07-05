// Patterns adapted from gitleaks (MIT). See ./CREDITS.md.
import type { RuleSpec } from '../define';

/**
 * Observability / monitoring tokens (Sentry, New Relic, Datadog, Grafana, PagerDuty). Sentry
 * DSNs embed the secret in a URL; New Relic & Grafana have fixed prefixes; Datadog's loose
 * hex key is hard-gated with an entropy floor + placeholder + example-path gate.
 */
export const observabilitySpecs: readonly RuleSpec[] = [
  {
    id: 'sentry-dsn',
    name: 'Sentry DSN',
    severity: 'medium',
    // `https://<32 hex public key>@<org>.ingest.sentry.io/<project>`.
    pattern:
      /https:\/\/[0-9a-f]{32}@[0-9a-z.-]+\.ingest\.(?:[a-z]{2}\.)?sentry\.io\/[0-9]+/g,
    keywords: ['ingest', 'sentry.io'],
    mask: { kind: 'middle', head: 12, tail: 6 },
    message: 'Looks like a Sentry DSN — it can submit events to your Sentry project.',
  },
  {
    id: 'newrelic-key',
    name: 'New Relic Key',
    severity: 'high',
    // `NRAK-` (user API key) / `NRAA-` (account) / `NRJS-` (browser) + 27 chars.
    pattern: /\bNR(?:AK|AA|JS|II|RA|SP|MA)-[0-9A-Za-z]{27}\b/g,
    keywords: ['NRAK-', 'NRAA-', 'NRJS-', 'NRII-', 'NRRA-', 'NRSP-', 'NRMA-'],
    mask: { kind: 'prefix', head: 5 },
    message: 'Looks like a New Relic API key.',
  },
  {
    id: 'datadog-api-key',
    name: 'Datadog API Key',
    severity: 'high',
    // Lookbehind on a `datadog`/`dd_api`-context assignment → group 0 is the 32-char hex key.
    pattern: /(?<=(?:datadog|dd[_-]?api)[^\n]{0,30}["']?[:=]\s*["']?)[0-9a-f]{32}\b/gi,
    keywords: ['datadog', 'dd_api', 'dd-api'],
    entropyFloor: 3.0,
    gatePlaceholder: true,
    gateExamplePath: true,
    mask: { kind: 'middle', head: 4, tail: 4 },
    message: 'Looks like a Datadog API key.',
  },
  {
    id: 'grafana-token',
    name: 'Grafana Service Account Token',
    severity: 'high',
    // `glc_` (cloud) + base64 body. gitleaks: glc_[A-Za-z0-9+/]{32,400}={0,2}.
    pattern: /\bglc_[0-9A-Za-z+/]{32,200}={0,2}/g,
    keywords: ['glc_'],
    mask: { kind: 'prefix', head: 4 },
    message: 'Looks like a Grafana service-account token.',
  },
  {
    id: 'pagerduty-token',
    name: 'PagerDuty API Token',
    severity: 'high',
    // PagerDuty v2 API token: `pdu_`/`pds_` (region) + 32 url-safe chars.
    pattern: /\bpd[us]_[0-9A-Za-z_-]{32}\b/g,
    keywords: ['pdu_', 'pds_'],
    mask: { kind: 'prefix', head: 4 },
    message: 'Looks like a PagerDuty API token.',
  },
];
