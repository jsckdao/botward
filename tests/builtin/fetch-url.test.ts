import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import '../../src/tools/builtin/tools/fetch-url.js';
import { getBuiltinTool } from '../../src/tools/builtin/registry.js';

describe('fetch_url builtin', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('denies when no permission is set', async () => {
    const tool = getBuiltinTool('fetch_url');
    await expect(tool.run({ url: 'https://example.com' })).rejects.toThrow(/denied/);
  });

  it('blocks private IPs even with permission', async () => {
    const tool = getBuiltinTool('fetch_url', {
      expression: 'http://127.0.0.1/*',
      extraPatterns: [],
    });
    await expect(tool.run({ url: 'http://127.0.0.1/x' })).rejects.toThrow(/private or loopback/);
  });

  it('blocks localhost by hostname', async () => {
    const tool = getBuiltinTool('fetch_url', {
      expression: 'http://localhost/*',
      extraPatterns: [],
    });
    await expect(tool.run({ url: 'http://localhost:3000/api' })).rejects.toThrow(/private or loopback/);
  });

  it('blocks 10.x.x.x private range', async () => {
    const tool = getBuiltinTool('fetch_url', {
      expression: 'http://10.0.0.1/*',
      extraPatterns: [],
    });
    await expect(tool.run({ url: 'http://10.0.0.1/' })).rejects.toThrow(/private or loopback/);
  });

  it('blocks 192.168.x.x private range', async () => {
    const tool = getBuiltinTool('fetch_url', {
      expression: 'http://192.168.1.1/*',
      extraPatterns: [],
    });
    await expect(tool.run({ url: 'http://192.168.1.1/' })).rejects.toThrow(/private or loopback/);
  });

  it('blocks IPv6 loopback', async () => {
    const tool = getBuiltinTool('fetch_url', {
      expression: 'http://[::1]/*',
      extraPatterns: [],
    });
    await expect(tool.run({ url: 'http://[::1]/' })).rejects.toThrow(/private or loopback/);
  });

  it('rejects URLs not in allowlist', async () => {
    const tool = getBuiltinTool('fetch_url', {
      expression: 'https://api.example.com/*',
      extraPatterns: [],
    });
    await expect(tool.run({ url: 'https://other.com/' })).rejects.toThrow(/not in permission/);
  });

  it('returns response on success', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://api.example.com/x',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"ok":true}'));
          controller.close();
        },
      }),
    })) as any;

    const tool = getBuiltinTool('fetch_url', {
      expression: 'https://api.example.com/**',
      extraPatterns: [],
    });
    const result = await tool.run({ url: 'https://api.example.com/x' });
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      body: '{"ok":true}',
    });
  });

  it('rejects oversized responses', async () => {
    const big = new Uint8Array(2_000_000); // 2 MB
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://api.example.com/big',
      headers: new Headers(),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(big);
          controller.close();
        },
      }),
    })) as any;

    const tool = getBuiltinTool('fetch_url', {
      expression: 'https://api.example.com/**',
      extraPatterns: [],
    });
    await expect(tool.run({ url: 'https://api.example.com/big' })).rejects.toThrow(/exceeded/);
  });
});