/**
 * Masking helpers for safe-to-display previews. The masked preview is what we show in
 * hovers and the panel — we never echo a full secret back to the user.
 */

/**
 * Keep the first `head` and last `tail` characters, replacing the middle with `*`.
 * If the value is too short to keep both ends distinct, mask it entirely.
 */
export function maskMiddle(value: string, head: number, tail: number): string {
  if (value.length <= head + tail) {
    return '*'.repeat(value.length);
  }
  const starCount = Math.max(3, value.length - head - tail);
  return value.slice(0, head) + '*'.repeat(starCount) + value.slice(value.length - tail);
}

/** Fully mask every character. */
export function maskAll(value: string): string {
  return '*'.repeat(value.length);
}

/** Mask keeping a short recognizable prefix only (e.g. `AKIA****…`). */
export function maskPrefix(value: string, head: number): string {
  if (value.length <= head) {
    return '*'.repeat(value.length);
  }
  return value.slice(0, head) + '…' + '*'.repeat(Math.min(8, value.length - head));
}
