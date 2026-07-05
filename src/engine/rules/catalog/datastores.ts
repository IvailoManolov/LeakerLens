// Patterns adapted from gitleaks (MIT). See ./CREDITS.md.
import type { RuleSpec } from '../define';

/**
 * Datastore credentials, split into two exports: PlanetScale tokens (fixed prefix, run with
 * the providers) and database connection strings (the highest-FP-risk family, run last).
 */
/** Fixed-prefix datastore tokens (run with the other providers). */
export const datastoreProviderSpecs: readonly RuleSpec[] = [
  {
    id: 'planetscale-password',
    name: 'PlanetScale Password',
    severity: 'high',
    // `pscale_pw_` (password) / `pscale_tkn_` (token) + url-safe body.
    pattern: /\bpscale_(?:pw|tkn)_[0-9A-Za-z_.-]{32,}\b/g,
    keywords: ['pscale_pw_', 'pscale_tkn_'],
    mask: { kind: 'prefix', head: 10 },
    message: 'Looks like a PlanetScale database password/token.',
  },
];

/**
 * Database connection strings (`scheme://user:PASSWORD@host`) — highest FP risk, run LAST
 * within the catalog. A lookbehind narrows group 0 to ONLY the password (the engine
 * masks/hashes group 0), they NEVER match a password-less URL, and they require an entropy
 * floor >= 3.3 plus placeholder + example-path gates.
 */
export const connectionStringSpecs: readonly RuleSpec[] = [
  {
    id: 'postgres-connection-password',
    name: 'Postgres Connection Password',
    severity: 'medium',
    // Lookbehind on `postgres(ql)://user:` → group 0 is the password, ended by `@host`.
    // The mandatory `:<password>@` shape means a password-less URL never matches.
    pattern: /(?<=\bpostgres(?:ql)?:\/\/[^\s:/@]+:)[^\s:/@]{6,}(?=@[^\s/]+)/g,
    keywords: ['postgres://', 'postgresql://'],
    entropyFloor: 3.3,
    gatePlaceholder: true,
    gateExamplePath: true,
    mask: { kind: 'all' },
    message: 'A Postgres connection string embeds a live password.',
  },
  {
    id: 'mysql-connection-password',
    name: 'MySQL Connection Password',
    severity: 'medium',
    pattern: /(?<=\bmysql(?:x)?:\/\/[^\s:/@]+:)[^\s:/@]{6,}(?=@[^\s/]+)/g,
    keywords: ['mysql://', 'mysqlx://'],
    entropyFloor: 3.3,
    gatePlaceholder: true,
    gateExamplePath: true,
    mask: { kind: 'all' },
    message: 'A MySQL connection string embeds a live password.',
  },
  {
    id: 'mongodb-connection-password',
    name: 'MongoDB Connection Password',
    severity: 'medium',
    pattern: /(?<=\bmongodb(?:\+srv)?:\/\/[^\s:/@]+:)[^\s:/@]{6,}(?=@[^\s/]+)/g,
    keywords: ['mongodb://', 'mongodb+srv://'],
    entropyFloor: 3.3,
    gatePlaceholder: true,
    gateExamplePath: true,
    mask: { kind: 'all' },
    message: 'A MongoDB connection string embeds a live password.',
  },
  {
    id: 'redis-connection-password',
    name: 'Redis Connection Password',
    severity: 'medium',
    pattern: /(?<=\brediss?:\/\/[^\s:/@]+:)[^\s:/@]{6,}(?=@[^\s/]+)/g,
    keywords: ['redis://', 'rediss://'],
    entropyFloor: 3.3,
    gatePlaceholder: true,
    gateExamplePath: true,
    mask: { kind: 'all' },
    message: 'A Redis connection string embeds a live password.',
  },
];
