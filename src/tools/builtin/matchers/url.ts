import { globToRegex } from './glob.js';

interface ParsedUrlPattern {
  protocol: string;
  host: string;
  path: string;
}

/**
 * URL pattern matcher for fetch_url permissions.
 *
 * Pattern format:
 *   - protocol must match exactly (`https://` vs `http://` matters)
 *   - host supports segment-level wildcards: `https://*.example.com`
 *   - path supports glob (`*`, `**`, `?`)
 *
 * Query strings, ports, and userinfo are not considered for matching.
 */
export function matchUrl(input: string, pattern: string): boolean {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return false;
  }
  const p = parsePattern(pattern);
  if (!p) return false;
  if (u.protocol !== p.protocol) return false;
  if (!matchHost(u.hostname, p.host)) return false;
  // If pattern omitted a path, match anything. Otherwise exact glob match.
  const patternPath = p.path === '/' && !pattern.includes('/', p.protocol.length + 3)
    ? '**'
    : p.path;
  if (!globToRegex(patternPath).test(u.pathname || '/')) return false;
  return true;
}

/**
 * Parse a pattern URL allowing `*` segments in the host. Standard `new URL()`
 * rejects `*` so we extract scheme/host/path manually.
 */
function parsePattern(pattern: string): ParsedUrlPattern | null {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*:)(\/\/)([^\/]+)(\/.*)?$/.exec(pattern);
  if (!m) return null;
  // Normalize protocol to `scheme:` (no slashes) so it matches URL.protocol.
  const protocol = m[1]!;
  let host = m[3]!;
  // Strip userinfo and port — they're not used for matching.
  const at = host.lastIndexOf('@');
  if (at >= 0) host = host.slice(at + 1);
  const path = m[4] ?? '/';
  return { protocol, host, path };
}

function matchHost(inputHost: string, patternHost: string): boolean {
  if (patternHost === '*') return true;
  if (!patternHost.includes('*')) return inputHost === patternHost;
  const pSegs = patternHost.split('.');
  const iSegs = inputHost.split('.');
  if (pSegs.length !== iSegs.length) return false;
  return pSegs.every((seg, i) => seg === '*' || seg === iSegs[i]);
}