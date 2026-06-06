import { describe, expect, it } from 'vitest';
import { scanText } from '../../src/engine';
import type { Finding } from '../../src/engine';

const FILE = 'src/app.ts';
const scan = (text: string, filename = FILE): Finding[] => scanText(text, { filename });
const ids = (text: string, filename = FILE): string[] => scan(text, filename).map((f) => f.ruleId);

describe('headline ruleset — positives', () => {
  it('detects an AWS Access Key ID', () => {
    const f = scan('const k = "AKIAIOSFODNN7QWERTYZ"');
    expect(f).toHaveLength(1);
    expect(f[0].ruleId).toBe('aws-access-key-id');
    expect(f[0].severity).toBe('critical');
    expect(f[0].matchPreview).toBe('AKIA…********');
  });

  it('detects a Google/GCP API key', () => {
    expect(ids('key = AIzaA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r')).toContain('gcp-api-key');
  });

  it('detects a GitHub token', () => {
    expect(ids('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')).toContain('github-token');
  });

  it('detects a Stripe secret key', () => {
    // Assembled at runtime so the literal token never appears in source — otherwise
    // secret scanners (GitHub push protection) flag this fixture as a real key.
    const stripe = ['sk', 'live', '4eC39HqLyjWDarjtT1zdp7dc'].join('_');
    expect(ids(stripe)).toContain('stripe-secret-key');
  });

  it('detects an Anthropic API key (and it wins over the generic sk- rule)', () => {
    const f = scan('sk-ant-api03-A1b2C3d4E5f6G7h8I9j0');
    expect(f).toHaveLength(1);
    expect(f[0].ruleId).toBe('anthropic-api-key');
  });

  it('detects an OpenAI API key', () => {
    expect(ids('const v = sk-proj-Ab12Cd34Ef56Gh78Ij90Kl12Mn34')).toContain('openai-api-key');
  });

  it('detects a Slack token', () => {
    expect(ids('xoxb-123456789012-abcdefghijkl')).toContain('slack-token');
  });

  it('detects a JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV';
    expect(ids(jwt)).toContain('jwt');
  });

  it('detects PEM private keys (and offers only ignore/mask)', () => {
    const f = scan('-----BEGIN RSA PRIVATE KEY-----');
    expect(f).toHaveLength(1);
    expect(f[0].ruleId).toBe('private-key');
    expect(f[0].remediations.map((r) => r.kind)).toEqual(['ignore', 'mask']);
    // The generic header form also matches.
    expect(ids('-----BEGIN PRIVATE KEY-----')).toContain('private-key');
  });

  it('detects a generic high-entropy secret in a secret-like assignment', () => {
    const f = scan('const secret = "aZ9kP3xR7mQ2wL5tN8vBcD"');
    expect(f).toHaveLength(1);
    expect(f[0].ruleId).toBe('high-entropy-secret');
    expect(f[0].entropy).toBeGreaterThan(3.5);
  });

  it('detects a hardcoded value against an UPPER_SNAKE env name', () => {
    const f = scan('DATABASE_URL = "aZ9kP3xR7mQ2wL5t"');
    expect(f).toHaveLength(1);
    expect(f[0].ruleId).toBe('dotenv-value-leak');
  });
});

describe('headline ruleset — negatives (precision gates)', () => {
  it('drops low-entropy values that match a key shape', () => {
    expect(scan('const v = "sk-aaaaaaaaaaaaaaaaaaaa"')).toHaveLength(0);
  });

  it('drops placeholder values even when high-entropy (openai)', () => {
    expect(scan('const v = "sk-EXAMPLEa9K3mZ8qP1xR7tWb2"')).toHaveLength(0);
  });

  it('drops placeholder values in a secret-like assignment (generic)', () => {
    expect(scan('const secret = "exampleZ9K3mP1xR7tWbQ12"')).toHaveLength(0);
  });

  it('drops placeholder env values (dotenv first gate)', () => {
    expect(scan('DATABASE_URL = "your-key-here-aZ9kP3"')).toHaveLength(0);
  });

  it('skips example/test files for the env-leak rule (dotenv second gate)', () => {
    expect(scan('API_TOKEN_VALUE = "aZ9kP3xR7mQ2wL5t"', 'config.example.ts')).toHaveLength(0);
  });

  it('finds nothing in ordinary prose', () => {
    expect(scan('hello world, this is a perfectly normal sentence.')).toHaveLength(0);
  });
});
