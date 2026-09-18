/**
 * Command pattern matcher for run_command permissions.
 *
 * Pattern format: space-separated tokens, where `*` matches any sequence of
 * remaining tokens. Tokens are split on whitespace with no quoting or
 * escaping (keep it simple — `git *` for "git plus any args", `git status`
 * for exact). If the pattern contains no `*`, the input must match exactly.
 */
export function matchCommand(input: string, pattern: string): boolean {
  const inputTokens = input.trim().split(/\s+/).filter((t) => t.length > 0);
  const patternTokens = pattern.trim().split(/\s+/).filter((t) => t.length > 0);
  if (patternTokens.length === 0) return false;
  if (inputTokens.length < patternTokens.length) return false;

  const hasWildcard = patternTokens.includes('*');
  const effectiveLen = hasWildcard ? patternTokens.length : patternTokens.length;
  if (!hasWildcard && inputTokens.length !== patternTokens.length) return false;

  for (let i = 0; i < effectiveLen; i++) {
    const p = patternTokens[i]!;
    if (p === '*') continue;
    if (inputTokens[i] !== p) return false;
  }
  return true;
}