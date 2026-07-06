/**
 * EnvGitignoreClassifier cache semantics.
 *
 * The classifier's answer decides whether an exposed `.env`'s secrets are COUNTED — so its
 * caching must never pin a transient git failure ('unknown') for the whole session, and two
 * overlapping classify() calls for the same path must not race each other's cache writes
 * (last-writer-wins made rescan counts depend on child-process resolution order).
 *
 * `child_process.execFile` is mocked; no real git runs here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({ execFile: vi.fn() }));

import { execFile } from 'child_process';
import { EnvGitignoreClassifier } from '../../src/extension/envFiles';

const execFileMock = vi.mocked(execFile);

/** Configure the mock to answer every git spawn with `exitCode` (null error = exit 0). */
function gitAnswers(exitCode: number | null, delayMs = 0): void {
  execFileMock.mockImplementation(((
    _cmd: string,
    _args: readonly string[],
    _opts: unknown,
    cb: (error: Error | null) => void,
  ) => {
    const error =
      exitCode === null ? null : Object.assign(new Error(`exit ${exitCode}`), { code: exitCode });
    if (delayMs > 0) {
      setTimeout(() => cb(error), delayMs);
    } else {
      queueMicrotask(() => cb(error));
    }
    return {};
  }) as unknown as typeof execFile);
}

beforeEach(() => {
  execFileMock.mockReset();
});

describe('EnvGitignoreClassifier.classify', () => {
  it("caches a definitive 'ignored' answer (one git spawn for repeated calls)", async () => {
    gitAnswers(null); // exit 0 = ignored
    const classifier = new EnvGitignoreClassifier();
    expect(await classifier.classify('/repo/.env')).toBe('ignored');
    expect(await classifier.classify('/repo/.env')).toBe('ignored');
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("caches a definitive 'exposed' answer", async () => {
    gitAnswers(1); // exit 1 = not ignored
    const classifier = new EnvGitignoreClassifier();
    expect(await classifier.classify('/repo/.env')).toBe('exposed');
    expect(await classifier.classify('/repo/.env')).toBe('exposed');
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache a transient 'unknown' failure — the next scan retries git", async () => {
    gitAnswers(128); // exit 128 = git error / not a repo
    const classifier = new EnvGitignoreClassifier();
    expect(await classifier.classify('/repo/.env')).toBe('unknown');
    expect(await classifier.classify('/repo/.env')).toBe('unknown');
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });

  it("recovers to the real answer after a transient failure", async () => {
    gitAnswers(128);
    const classifier = new EnvGitignoreClassifier();
    expect(await classifier.classify('/repo/.env')).toBe('unknown');
    gitAnswers(1); // git works again
    expect(await classifier.classify('/repo/.env')).toBe('exposed');
    // ...and the recovered answer is cached.
    expect(await classifier.classify('/repo/.env')).toBe('exposed');
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent classify() calls for the same path into one git spawn', async () => {
    gitAnswers(null, 20); // slow git keeps the race window open
    const classifier = new EnvGitignoreClassifier();
    const [a, b] = await Promise.all([
      classifier.classify('/repo/.env'),
      classifier.classify('/repo/.env'),
    ]);
    expect(a).toBe('ignored');
    expect(b).toBe('ignored');
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it('invalidate() drops cached answers so the next call re-asks git', async () => {
    gitAnswers(null);
    const classifier = new EnvGitignoreClassifier();
    await classifier.classify('/repo/.env');
    classifier.invalidate();
    await classifier.classify('/repo/.env');
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });
});
