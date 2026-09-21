/**
 * Parses a context-length string into a token count.
 *
 * Accepted forms:
 *   "262144"     → 262144
 *   "256k"       → 256_000   (k = 1000)
 *   "256K"       → 256_000
 *   "1m"         → 1_000_000 (m = 1_000_000)
 *   "  256K "    → 256_000   (whitespace tolerated)
 *   "1.5m"       → 1_500_000 (decimals allowed)
 *
 * Returns null when the input cannot be parsed (empty, non-numeric, wrong unit
 * suffix, non-positive result). The caller is responsible for translating null
 * into a user-facing error.
 */
export function parseContextLength(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const match = /^(\d+(?:\.\d+)?)\s*([kKmM]?)$/.exec(trimmed);
  if (!match) return null;

  const num = Number(match[1]);
  const unit = (match[2] ?? '').toLowerCase();
  if (!Number.isFinite(num) || num <= 0) return null;

  const multiplier = unit === 'k' ? 1_000 : unit === 'm' ? 1_000_000 : 1;
  const value = Math.round(num * multiplier);
  return value > 0 ? value : null;
}
