// Patterns adapted from gitleaks (MIT). See ./CREDITS.md.
import type { RuleSpec } from '../define';

/**
 * Source-control and CI/CD provider tokens. Each has a fixed, unguessable prefix, so the
 * prefix itself is the precision — no entropy floor needed, keyword == prefix.
 */
export const sourceCiSpecs: readonly RuleSpec[] = [
  {
    id: 'gitlab-pat',
    name: 'GitLab Personal Access Token',
    severity: 'high',
    // `glpat-` + 20 url-safe chars. gitleaks uses {20,22}; we anchor to 20+ with a boundary.
    pattern: /\bglpat-[0-9A-Za-z_-]{20}\b/g,
    keywords: ['glpat-'],
    mask: { kind: 'prefix', head: 6 },
    message: 'Looks like a GitLab personal access token — it can read and write your repos.',
  },
  {
    id: 'github-fine-grained-pat',
    name: 'GitHub Fine-grained PAT',
    severity: 'high',
    // `github_pat_` + base62 body. gitleaks: github_pat_[0-9a-zA-Z_]{82}.
    pattern: /\bgithub_pat_[0-9A-Za-z_]{82}\b/g,
    keywords: ['github_pat_'],
    mask: { kind: 'prefix', head: 11 },
    message: 'Looks like a GitHub fine-grained personal access token.',
  },
  {
    id: 'npm-access-token',
    name: 'npm Access Token',
    severity: 'high',
    // `npm_` + 36 base62 chars (classic npm automation token).
    pattern: /\bnpm_[0-9A-Za-z]{36}\b/g,
    keywords: ['npm_'],
    mask: { kind: 'prefix', head: 4 },
    message: 'Looks like an npm access token — it can publish packages to your account.',
  },
  {
    id: 'pypi-upload-token',
    name: 'PyPI Upload Token',
    severity: 'high',
    // `pypi-` + base64url body (PyPI tokens are long; require 32+ after the prefix).
    pattern: /\bpypi-AgEIcHlwaS5vcmc[0-9A-Za-z_-]{32,}\b/g,
    keywords: ['pypi-AgEIcHlwaS5vcmc'],
    mask: { kind: 'prefix', head: 8 },
    message: 'Looks like a PyPI upload token — it can publish packages to PyPI.',
  },
  {
    id: 'dockerhub-pat',
    name: 'Docker Hub Access Token',
    severity: 'high',
    // `dckr_pat_` + url-safe body. gitleaks: dckr_pat_[a-zA-Z0-9_-]{27}.
    pattern: /\bdckr_pat_[0-9A-Za-z_-]{27}\b/g,
    keywords: ['dckr_pat_'],
    mask: { kind: 'prefix', head: 9 },
    message: 'Looks like a Docker Hub personal access token.',
  },
  {
    id: 'terraform-cloud-token',
    name: 'Terraform Cloud Token',
    severity: 'high',
    // `<14 base62>.atlasv1.<70+ base62>` — the `.atlasv1.` infix is the precision.
    pattern: /\b[0-9A-Za-z]{14}\.atlasv1\.[0-9A-Za-z_-]{60,}\b/g,
    keywords: ['.atlasv1.'],
    mask: { kind: 'middle', head: 6, tail: 4 },
    message: 'Looks like a Terraform Cloud / Enterprise API token.',
  },
  {
    id: 'atlassian-api-token',
    name: 'Atlassian API Token',
    severity: 'high',
    // `ATATT3` (Atlassian API token v3 prefix) + long base64url body + trailing checksum.
    pattern: /\bATATT3[0-9A-Za-z_=-]{180,}\b/g,
    keywords: ['ATATT3'],
    mask: { kind: 'prefix', head: 6 },
    message: 'Looks like an Atlassian (Jira/Confluence) API token.',
  },
];
