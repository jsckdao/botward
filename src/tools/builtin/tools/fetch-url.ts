import { BotwardError } from '../../../utils/errors.js';
import type { LoadedTool, ResolvedPermissions } from '../../sandbox.js';
import { matchUrl } from '../matchers/url.js';
import { registerBuiltin } from '../registry.js';

const DEFAULT_MAX_BYTES = 1_000_000; // 1 MB response cap

/**
 * Best-effort SSRF guard: refuse to fetch hosts that resolve to private,
 * loopback, link-local, or otherwise non-public IP space. NOTE: v1 does NOT
 * resolve the hostname — it pattern-matches the URL string. A determined
 * attacker can still DNS-rebind; users should add allowlist patterns for
 * sensitive internal hosts.
 */
function isBlockedHost(urlString: string): boolean {
  let u: URL;
  try {
    u = new URL(urlString);
  } catch {
    return true;
  }
  const host = u.hostname;
  // Strip IPv6 brackets if present.
  const bare = host.replace(/^\[|\]$/g, '');
  // IPv4 literal
  if (/^\d+\.\d+\.\d+\.\d+$/.test(bare)) {
    const parts = bare.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true; // link-local
    if (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127) return true; // CGNAT
    if (parts[0] >= 224) return true; // multicast + reserved
  }
  // IPv6 literal — block ::1, fc00::/7, fe80::/10, multicast
  if (bare.includes(':')) {
    const lower = bare.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
    if (lower.startsWith('ff')) return true;
  }
  // Hostname-based checks (best-effort without DNS lookup)
  if (bare === 'localhost' || bare.endsWith('.localhost') || bare.endsWith('.local')) return true;
  return false;
}

function build(permissions?: ResolvedPermissions): LoadedTool {
  return {
    name: 'fetch_url',
    description:
      'Fetch an HTTP/HTTPS URL. Default policy blocks private/loopback hosts. Set `permission` (URL pattern) to scope to specific origins.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch (must be http(s)).' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], default: 'GET' },
        headers: { type: 'object', description: 'Optional request headers.', additionalProperties: { type: 'string' } },
        body: { type: 'string', description: 'Optional request body (POST/PUT/PATCH).' },
      },
      required: ['url'],
    },
    run: async (args, perms) => {
      const url = String(args.url ?? '');
      if (!url) throw new BotwardError('fetch_url: "url" is required');
      const method = String(args.method ?? 'GET');

      const effective = perms ?? permissions;
      if (!effective || (effective.expression === undefined && effective.extraPatterns.length === 0)) {
        throw new BotwardError(
          'fetch_url denied by default — set "permission" in config to allow specific URLs',
        );
      }

      const patterns: string[] = [];
      if (effective.expression) patterns.push(effective.expression);
      patterns.push(...effective.extraPatterns);
      if (!patterns.some((p) => matchUrl(url, p))) {
        throw new BotwardError(`fetch_url denied: "${url}" not in permission allowlist`);
      }

      if (isBlockedHost(url)) {
        throw new BotwardError(`fetch_url denied: host is private or loopback`);
      }

      const headers = (args.headers ?? {}) as Record<string, string>;
      const init: RequestInit = { method, headers };
      if (args.body !== undefined && method !== 'GET' && method !== 'HEAD') {
        init.body = String(args.body);
      }

      const resp = await fetch(url, init);
      const reader = resp.body?.getReader();
      let received = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            received += value.byteLength;
            if (received > DEFAULT_MAX_BYTES) {
              await reader.cancel();
              throw new BotwardError(
                `fetch_url: response exceeded ${DEFAULT_MAX_BYTES} bytes`,
              );
            }
            chunks.push(value);
          }
        }
      }
      const bodyBuf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      return {
        ok: resp.ok,
        status: resp.status,
        statusText: resp.statusText,
        url: resp.url,
        headers: Object.fromEntries(resp.headers.entries()),
        body: bodyBuf.toString('utf-8'),
        bytes: bodyBuf.length,
      };
    },
    maxOutputBytes: 50_000,
    timeoutMs: 30_000,
    permissions,
  };
}

registerBuiltin('fetch_url', build);