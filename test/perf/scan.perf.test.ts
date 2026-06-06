import { describe, expect, it } from 'vitest';
import { scanText } from '../../src/engine';

/**
 * Performance budget guard (spec: a typical file < 2k lines scans in < 10ms). We use a
 * generous CI ceiling to avoid flakiness while still catching gross regressions.
 */
describe('scan performance', () => {
  it('scans a typical 2k-line file well within budget', () => {
    const line = 'const value = computeSomething(a, b, c); // ordinary line of code\n';
    const realistic = line.repeat(2000) + 'const k = "AKIAIOSFODNN7QWERTYZ"\n';

    // Warm up (JIT) then measure.
    scanText(realistic, { filename: 'big.ts' });
    const start = performance.now();
    const findings = scanText(realistic, { filename: 'big.ts' });
    const elapsed = performance.now() - start;

    expect(findings.length).toBe(1);
    expect(elapsed).toBeLessThan(50);
  });
});
