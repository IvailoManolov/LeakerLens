import type * as vscode from 'vscode';
import { verifyLicenseKey } from './verify';

const STORAGE_KEY = 'leaklens.licenseKey';

/**
 * The single Pro gate. `isPro()` is the only check the rest of the extension uses;
 * Pro features degrade to a tasteful upsell, never a broken state.
 */
export class License {
  private pro = false;

  constructor(private readonly memento: vscode.Memento) {
    const stored = memento.get<string>(STORAGE_KEY);
    if (stored) {
      this.pro = verifyLicenseKey(stored, nowSeconds()) !== null;
    }
  }

  /** True when a valid, unexpired Pro key is active. */
  isPro(): boolean {
    return this.pro;
  }

  /** Verify and persist a key. Returns whether activation succeeded. */
  async activate(key: string): Promise<boolean> {
    const payload = verifyLicenseKey(key, nowSeconds());
    if (!payload) {
      return false;
    }
    await this.memento.update(STORAGE_KEY, key);
    this.pro = true;
    return true;
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
