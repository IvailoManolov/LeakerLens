import { describe, expect, it } from 'vitest';
import { EXCLUDED_DIRS, isExcludedPath } from '../../src/engine/scope';

// ---------------------------------------------------------------------------
// EXCLUDED_DIRS — shape and membership
// ---------------------------------------------------------------------------

describe('EXCLUDED_DIRS', () => {
  it('is a ReadonlySet', () => {
    // Verify it behaves as a Set (has `.has`, `.size`, etc.) and is non-empty.
    expect(EXCLUDED_DIRS).toBeInstanceOf(Set);
    expect(EXCLUDED_DIRS.size).toBeGreaterThan(0);
  });

  it('contains the canonical build/output/sandbox directory names', () => {
    const expected = [
      'node_modules',
      '.git',
      'dist',
      'out',
      'out-test',
      'build',
      '.vscode-test',
      'coverage',
      '.sandbox',
    ];
    for (const dir of expected) {
      expect(EXCLUDED_DIRS.has(dir), `expected '${dir}' in EXCLUDED_DIRS`).toBe(true);
    }
  });

  it('does not contain ordinary source directory names', () => {
    expect(EXCLUDED_DIRS.has('src')).toBe(false);
    expect(EXCLUDED_DIRS.has('lib')).toBe(false);
    expect(EXCLUDED_DIRS.has('test')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isExcludedPath — excluded paths (true positives)
// ---------------------------------------------------------------------------

describe('isExcludedPath — excluded paths', () => {
  it('detects node_modules at the top level with forward slash', () => {
    expect(isExcludedPath('node_modules/lodash/index.js')).toBe(true);
  });

  it('detects node_modules at the top level with back slash', () => {
    expect(isExcludedPath('node_modules\\lodash\\index.js')).toBe(true);
  });

  it('detects dist at the top level', () => {
    expect(isExcludedPath('dist/cli.js')).toBe(true);
  });

  it('detects out at the top level', () => {
    expect(isExcludedPath('out/extension.js')).toBe(true);
  });

  it('detects out-test at the top level', () => {
    expect(isExcludedPath('out-test/suite/index.js')).toBe(true);
  });

  it('detects build at the top level', () => {
    expect(isExcludedPath('build/main.js')).toBe(true);
  });

  it('detects .git at the top level', () => {
    expect(isExcludedPath('.git/config')).toBe(true);
  });

  it('detects .vscode-test at the top level', () => {
    expect(isExcludedPath('.vscode-test/stable/code')).toBe(true);
  });

  it('detects coverage at the top level', () => {
    expect(isExcludedPath('coverage/lcov.info')).toBe(true);
  });

  it('detects .sandbox at the top level', () => {
    expect(isExcludedPath('.sandbox/runtime.js')).toBe(true);
  });

  it('detects an excluded segment nested under a legitimate directory', () => {
    expect(isExcludedPath('packages/core/node_modules/foo/bar.ts')).toBe(true);
  });

  it('detects an excluded segment at any depth (mixed separators)', () => {
    expect(isExcludedPath('a/b\\dist\\bundle.js')).toBe(true);
  });

  it('detects an excluded segment when it is the only segment (just the dir name)', () => {
    expect(isExcludedPath('node_modules')).toBe(true);
    expect(isExcludedPath('dist')).toBe(true);
    expect(isExcludedPath('.git')).toBe(true);
  });

  it('detects out-test as an excluded segment even when nested', () => {
    expect(isExcludedPath('src/out-test/generated.ts')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isExcludedPath — non-excluded paths (true negatives)
// ---------------------------------------------------------------------------

describe('isExcludedPath — non-excluded paths', () => {
  it('passes an ordinary source file path', () => {
    expect(isExcludedPath('src/engine/scan.ts')).toBe(false);
  });

  it('passes a test file path', () => {
    expect(isExcludedPath('test/engine/scan.test.ts')).toBe(false);
  });

  it('passes a root-level file with no directory component', () => {
    expect(isExcludedPath('README.md')).toBe(false);
    expect(isExcludedPath('package.json')).toBe(false);
  });

  it('passes the empty string (no segments are excluded dir names)', () => {
    // split('') yields [''] — '' is not in EXCLUDED_DIRS.
    expect(isExcludedPath('')).toBe(false);
  });

  it('does not confuse a name that starts with an excluded word (e.g. "distribution")', () => {
    expect(isExcludedPath('distribution/index.ts')).toBe(false);
  });

  it('does not confuse a name that ends with an excluded word (e.g. "my-dist")', () => {
    expect(isExcludedPath('packages/my-dist/index.ts')).toBe(false);
  });

  it('does not confuse a file whose name contains "node_modules" as a substring of a longer name', () => {
    // e.g. a dir literally named 'my-node_modules' should NOT be excluded — only an
    // exact segment match triggers exclusion.
    // Note: 'my-node_modules' split on [/\\] gives ['my-node_modules'] which is NOT in the set.
    expect(isExcludedPath('my-node_modules/foo.ts')).toBe(false);
  });

  it('passes a deeply nested legitimate path with back slashes', () => {
    expect(isExcludedPath('src\\extension\\panel\\host.ts')).toBe(false);
  });

  it('passes a path whose file name matches an excluded dir (segments are file names, not the full path)', () => {
    // The file is named "dist" but it's a file in src/, not a directory called dist.
    // isExcludedPath only checks segments — a segment literally equal to 'dist' would
    // be excluded. Here the segment IS 'dist' so this should correctly return true.
    // This case explicitly documents the semantic: any segment matching an excluded dir
    // name triggers exclusion regardless of whether it is a file or directory.
    expect(isExcludedPath('src/dist')).toBe(true); // segment 'dist' matches
  });

  it('passes a path with a .git-like prefix that is not exactly .git', () => {
    expect(isExcludedPath('.github/workflows/ci.yml')).toBe(false);
    expect(isExcludedPath('.gitignore')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Separator handling — both / and \ at every position
// ---------------------------------------------------------------------------

describe('isExcludedPath — separator edge cases', () => {
  it('handles a path with only back slashes', () => {
    expect(isExcludedPath('src\\engine\\scope.ts')).toBe(false);
    expect(isExcludedPath('node_modules\\react\\index.js')).toBe(true);
  });

  it('handles a path with only forward slashes', () => {
    expect(isExcludedPath('src/engine/scope.ts')).toBe(false);
    expect(isExcludedPath('node_modules/react/index.js')).toBe(true);
  });

  it('handles a path with mixed separators', () => {
    expect(isExcludedPath('src\\engine/scope.ts')).toBe(false);
    expect(isExcludedPath('node_modules\\react/index.js')).toBe(true);
  });
});
