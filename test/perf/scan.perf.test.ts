import { describe, expect, it } from 'vitest';
import { scanText } from '../../src/engine';

/**
 * Performance budget guard (spec: a typical file < 2k lines scans in < 50ms). We use a
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

  it('scans a large file dense with new catalog keywords within budget', () => {
    // Each line contains one catalog keyword that must pass the pre-filter
    // but produce no actual finding (tests that regex short-circuits cleanly).
    const keywordLines = [
      'const a = glpat_not_a_real_token_here;\n',
      'const b = npm_not_a_real_token_here;\n',
      'const c = "https://hooks.slack.com/services/not/a/real";\n',
      'const d = NRAK_not_a_real_key;\n',
      'const e = glc_not_a_real_grafana_token;\n',
      'const f = pdu_not_a_real_pagerduty_token;\n',
      'const g = hf_not_a_real_token;\n',
      'const h = r8_not_a_real_token;\n',
      'const i = gsk_not_a_real_token;\n',
    ].join('');

    // Build a ~2k-line file with keyword lines interspersed throughout
    const lineCount = Math.floor(2000 / keywordLines.split('\n').length);
    const bigFile = keywordLines.repeat(lineCount);

    // Warm up then measure.
    scanText(bigFile, { filename: 'big-keywords.ts' });
    const start = performance.now();
    scanText(bigFile, { filename: 'big-keywords.ts' });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
  });
});
