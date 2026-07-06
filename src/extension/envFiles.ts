/**
 * `.env`-file awareness for the extension layer. The pure engine has no filesystem or git
 * access (and must stay that way), so deciding *which* files are real env files and whether
 * they're tracked by git lives here, in the VS Code glue.
 */
import { execFile, type ExecFileException } from 'child_process';
import { dirname } from 'path';
import { isEnvFile } from '../engine';

/**
 * True for a real, secret-bearing dotenv file. Re-exported from the engine's {@link isEnvFile}
 * so the env-file detection rule and this glue agree on exactly which files count as `.env`.
 */
export const isProtectedEnvFile = isEnvFile;

/** The result of asking git whether a `.env` file would be committed. */
export type EnvGitStatus = 'ignored' | 'exposed' | 'unknown';

/**
 * Asks `git check-ignore` whether a `.env` file is gitignored, caching the answer per path.
 * `unknown` means "not a git repo / git unavailable" — the caller treats that as safe and
 * never raises the exposed warning, so non-git projects are left alone.
 */
export class EnvGitignoreClassifier {
  /** Holds the in-flight promise while git answers, then the settled status. */
  private readonly ignoreCache = new Map<string, EnvGitStatus | Promise<EnvGitStatus>>();
  private readonly trackedCache = new Map<string, boolean>();

  classify(fsPath: string): Promise<EnvGitStatus> {
    const cached = this.ignoreCache.get(fsPath);
    if (cached !== undefined) {
      // Either a settled status or the in-flight promise — concurrent callers share one git
      // spawn, so overlapping scans can't race each other's cache writes (last-writer-wins
      // made the exposed count depend on child-process resolution order).
      return Promise.resolve(cached);
    }
    const pending = checkIgnore(fsPath).then((status) => {
      if (status === 'unknown') {
        // git itself failed (not on PATH, index.lock held, spawn pressure) — a transient
        // answer. Caching it pinned the `.env` "safe"/uncounted for the whole session; drop
        // it instead so the next scan retries.
        this.ignoreCache.delete(fsPath);
      } else {
        this.ignoreCache.set(fsPath, status);
      }
      return status;
    });
    this.ignoreCache.set(fsPath, pending);
    return pending;
  }

  /**
   * True when git is currently tracking `fsPath`. A `.env` can be both gitignored *and* tracked
   * (it was committed before the ignore rule existed); the ignore rule can't retroactively pull
   * it out of the repo, so its secrets are still in history. Lets the caller flag that.
   */
  async isTracked(fsPath: string): Promise<boolean> {
    const cached = this.trackedCache.get(fsPath);
    if (cached !== undefined) {
      return cached;
    }
    const tracked = await checkTracked(fsPath);
    this.trackedCache.set(fsPath, tracked);
    return tracked;
  }

  /** Drop all cached answers (e.g. after a `.gitignore` edit). */
  invalidate(): void {
    this.ignoreCache.clear();
    this.trackedCache.clear();
  }
}

function checkIgnore(fsPath: string): Promise<EnvGitStatus> {
  return new Promise((resolve) => {
    execFile(
      'git',
      // `--no-index` evaluates the ignore rules regardless of whether the file is tracked.
      // Without it, git reports an already-tracked `.env` as "not ignored" even when a
      // `.gitignore` rule matches it, so a user who gitignored a committed `.env` never sees green.
      ['check-ignore', '-q', '--no-index', '--', fsPath],
      { cwd: dirname(fsPath), encoding: 'utf8' },
      (error: ExecFileException | null) => {
        // `git check-ignore -q`: exit 0 = ignored, 1 = not ignored, 128 = not a repo / error.
        if (!error) {
          resolve('ignored');
        } else if (error.code === 1) {
          resolve('exposed');
        } else {
          resolve('unknown');
        }
      },
    );
  });
}

function checkTracked(fsPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['ls-files', '--error-unmatch', '--', fsPath],
      { cwd: dirname(fsPath), encoding: 'utf8' },
      // exit 0 = tracked; any error (1 = untracked, 128 = not a repo) = not tracked.
      (error: ExecFileException | null) => resolve(!error),
    );
  });
}
