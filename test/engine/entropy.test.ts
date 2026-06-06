import { describe, expect, it } from 'vitest';
import { shannonEntropy } from '../../src/engine/entropy';

describe('shannonEntropy', () => {
  it('returns 0 for the empty string', () => {
    expect(shannonEntropy('')).toBe(0);
  });

  it('returns 0 when every character is identical', () => {
    expect(shannonEntropy('aaaa')).toBe(0);
  });

  it('returns 1 bit for two equiprobable symbols', () => {
    expect(shannonEntropy('ab')).toBeCloseTo(1, 10);
  });

  it('counts repeated and first-seen characters (covers the ?? branch)', () => {
    // 'aab' exercises both the first-occurrence and the increment path.
    expect(shannonEntropy('aab')).toBeGreaterThan(0.9);
    expect(shannonEntropy('aab')).toBeLessThan(0.92);
  });

  it('grows with character diversity', () => {
    expect(shannonEntropy('aZ3kP9xR2mQ7')).toBeGreaterThan(3);
  });
});
