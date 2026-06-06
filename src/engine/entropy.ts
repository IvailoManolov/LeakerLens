/**
 * Shannon entropy — used to separate real secrets (high entropy) from prose and
 * placeholders (low entropy). Pure and allocation-light; called on short matched
 * substrings only, never whole files.
 */

/**
 * Shannon entropy in bits per character of `value`.
 * Returns 0 for the empty string.
 */
export function shannonEntropy(value: string): number {
  const len = value.length;
  if (len === 0) {
    return 0;
  }
  const counts = new Map<string, number>();
  for (const ch of value) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}
