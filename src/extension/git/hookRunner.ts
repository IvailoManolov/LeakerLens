/**
 * Standalone git pre-commit runner. Bundled to `dist/precommit.js` and copied into the
 * repo's `.git/hooks` at install time. Runs entirely locally with the pure engine — no
 * VS Code, no network. Reads staged blobs via git and scans them.
 *
 * Exit code: 0 = allow commit (warn-only or clean); 1 = block (only when
 * `LEAKLENS_BLOCK=1`, set by the installer when commit-blocking is enabled).
 */
import { execFileSync } from 'child_process';
import { scanText } from '../../engine';

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function stagedFiles(): string[] {
  try {
    return git(['diff', '--cached', '--name-only', '--diff-filter=ACM'])
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

function stagedContent(file: string): string {
  try {
    return git(['show', `:${file}`]);
  } catch {
    return '';
  }
}

function run(): number {
  const block = process.env.LEAKLENS_BLOCK === '1';
  let count = 0;
  for (const file of stagedFiles()) {
    for (const finding of scanText(stagedContent(file), { filename: file })) {
      count += 1;
      process.stderr.write(`  ${finding.severity.toUpperCase()}  ${finding.ruleName} — ${file}:${finding.line + 1}\n`);
    }
  }
  if (count > 0) {
    process.stderr.write(`\nLeakLens: ${count} potential secret(s) in staged changes.\n`);
    if (block) {
      process.stderr.write('Commit blocked. Remove the secrets, or use "git commit --no-verify" to override.\n');
      return 1;
    }
    process.stderr.write('(warn-only — commit allowed)\n');
  }
  return 0;
}

process.exit(run());
