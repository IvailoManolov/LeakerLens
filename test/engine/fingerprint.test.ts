import { describe, expect, it } from 'vitest';
import { fingerprint } from '../../src/engine';

describe('fingerprint', () => {
  it('is deterministic for the same input', () => {
    expect(fingerprint('AKIAIOSFODNN7QWERTYZ')).toBe(fingerprint('AKIAIOSFODNN7QWERTYZ'));
  });

  it('gives different inputs different fingerprints', () => {
    expect(fingerprint('hello')).not.toBe(fingerprint('hellp'));
    expect(fingerprint('secret-one')).not.toBe(fingerprint('secret-two'));
  });

  it('handles the empty string deterministically', () => {
    expect(fingerprint('')).toBe(fingerprint(''));
  });

  it('returns a lowercase hex string', () => {
    expect(fingerprint('some-secret-value')).toMatch(/^[0-9a-f]+$/);
  });
});
