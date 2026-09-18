/**
 * Tiny glob matcher for file paths. Supports:
 *   `*`  — any chars except `/` (single path segment)
 *   `**` — any chars including `/` (multiple segments)
 *   `?`  — exactly one char except `/`
 *
 * Other regex meta-chars in the pattern are escaped. We normalize both sides
 * to forward slashes so Windows users can write either.
 */
export function matchGlob(input: string, pattern: string): boolean {
  return globToRegex(pattern).test(normalize(input));
}

function normalize(s: string): string {
  return s.replace(/\\/g, '/');
}

export function globToRegex(pattern: string): RegExp {
  const norm = normalize(pattern);
  let out = '^';
  let i = 0;
  while (i < norm.length) {
    const c = norm[i]!;
    if (c === '*') {
      if (norm[i + 1] === '*') {
        // `**` — match across `/`. Consume an optional following `/`.
        out += '.*';
        i += 2;
        if (norm[i] === '/') i++;
      } else {
        out += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      out += '[^/]';
      i++;
    } else if ('.+^$()|{}[]\\'.includes(c)) {
      out += '\\' + c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  out += '$';
  return new RegExp(out);
}