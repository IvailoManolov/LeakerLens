import { describe, expect, it } from 'vitest';
import { maskAll, maskMiddle, maskPrefix } from '../../src/engine/mask';

describe('maskMiddle', () => {
  it('fully masks values too short to keep both ends', () => {
    expect(maskMiddle('abc', 4, 4)).toBe('***');
  });

  it('keeps head and tail for long values', () => {
    expect(maskMiddle('abcdefghij', 2, 2)).toBe('ab******ij');
  });

  it('uses at least three stars in the middle', () => {
    expect(maskMiddle('abcdefghi', 3, 3)).toBe('abc***ghi');
  });
});

describe('maskAll', () => {
  it('replaces every character with a star', () => {
    expect(maskAll('secret')).toBe('******');
  });
});

describe('maskPrefix', () => {
  it('fully masks values not longer than the head', () => {
    expect(maskPrefix('ab', 4)).toBe('**');
  });

  it('keeps a short prefix and a bounded star run', () => {
    expect(maskPrefix('AKIAIOSFODNN7QWERTYZ', 4)).toBe('AKIA…********');
  });

  it('bounds the star run to the remaining length', () => {
    expect(maskPrefix('abcdef', 4)).toBe('abcd…**');
  });
});
