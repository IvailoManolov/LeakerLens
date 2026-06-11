import { describe, expect, it } from 'vitest';
import { isEnvFile, isExamplePath, looksLikePlaceholder } from '../../src/engine/allowlist';

describe('looksLikePlaceholder', () => {
  it('flags known placeholder tokens (case-insensitive)', () => {
    expect(looksLikePlaceholder('YOUR-key-here')).toBe(true);
    expect(looksLikePlaceholder('someEXAMPLEvalue')).toBe(true);
    expect(looksLikePlaceholder('abcd1234')).toBe(true);
  });

  it('flags a single character repeated many times', () => {
    expect(looksLikePlaceholder('aaaaaa')).toBe(true);
  });

  it('does not flag a real-looking high-entropy value', () => {
    expect(looksLikePlaceholder('aZ9kP3xR7mQ2wL5t')).toBe(false);
  });
});

describe('isExamplePath', () => {
  it('matches example/sample/test/fixture style paths', () => {
    expect(isExamplePath('config.example.ts')).toBe(true);
    expect(isExamplePath('foo.spec.ts')).toBe(true);
    expect(isExamplePath('test/data.json')).toBe(true);
    expect(isExamplePath('seed.dist')).toBe(true);
  });

  it('does not match ordinary source paths', () => {
    expect(isExamplePath('src/index.ts')).toBe(false);
    expect(isExamplePath('lib/payments.ts')).toBe(false);
  });
});

describe('isEnvFile', () => {
  it('matches real dotenv files (any path separator, any case)', () => {
    expect(isEnvFile('.env')).toBe(true);
    expect(isEnvFile('/proj/.env')).toBe(true);
    expect(isEnvFile('C:\\proj\\.env.local')).toBe(true);
    expect(isEnvFile('.env.production')).toBe(true);
    expect(isEnvFile('.ENV')).toBe(true);
    expect(isEnvFile('config/production.env')).toBe(true);
  });

  it('excludes the committed placeholder templates', () => {
    expect(isEnvFile('.env.example')).toBe(false);
    expect(isEnvFile('.env.sample')).toBe(false);
    expect(isEnvFile('.env.template')).toBe(false);
    expect(isEnvFile('.env.dist')).toBe(false);
    expect(isEnvFile('.env.defaults')).toBe(false);
  });

  it('does not match ordinary files (or a bare "env")', () => {
    expect(isEnvFile('index.ts')).toBe(false);
    expect(isEnvFile('env')).toBe(false);
    expect(isEnvFile('environment.json')).toBe(false);
  });
});
