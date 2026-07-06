import * as vscode from 'vscode';

/** Resolved LeakerLens settings, read from the `leakerlens.*` configuration section. */
export interface LeakerLensConfig {
  readonly enable: boolean;
  readonly debounceMs: number;
  readonly commitBlocking: boolean;
  readonly maxFileSizeBytes: number;
}

/** Read current settings. Cheap; call on activation and on configuration change. */
export function readConfig(): LeakerLensConfig {
  const c = vscode.workspace.getConfiguration('leakerlens');
  return {
    enable: c.get<boolean>('enable', true),
    debounceMs: c.get<number>('debounceMs', 200),
    commitBlocking: c.get<boolean>('commitBlocking', false),
    maxFileSizeBytes: c.get<number>('maxFileSizeKb', 2048) * 1024,
  };
}
