import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { loadConfig } from '../src/config/loader.js';

const fixturesDir = path.resolve('tests/fixtures');

describe('loadConfig', () => {
  it('loads a valid config', async () => {
    const result = await loadConfig(path.join(fixturesDir, 'basic.json'));
    expect(result.config.name).toBe('Basic');
    expect(result.config.provider).toBe('anthropic');
    expect(result.config.tools).toHaveLength(1);
    expect(result.configDir).toBe(fixturesDir);
  });

  it('throws when file is missing', async () => {
    await expect(loadConfig('does/not/exist.json')).rejects.toThrow(/not found/);
  });

  it('throws when JSON is invalid', async () => {
    const fs = await import('node:fs/promises');
    const tmp = path.join(fixturesDir, '__bad.json');
    await fs.writeFile(tmp, '{ not valid');
    try {
      await expect(loadConfig(tmp)).rejects.toThrow(/not valid JSON/);
    } finally {
      await fs.unlink(tmp);
    }
  });

  it('rejects tools with neither code nor file', async () => {
    const fs = await import('node:fs/promises');
    const tmp = path.join(fixturesDir, '__bad_tool.json');
    await fs.writeFile(tmp, JSON.stringify({
      name: 'X',
      tools: [{ name: 'broken', description: 'd' }],
    }));
    try {
      await expect(loadConfig(tmp)).rejects.toThrow(/exactly one of "code" or "file"/);
    } finally {
      await fs.unlink(tmp);
    }
  });

  it('rejects tools with both code AND file', async () => {
    const fs = await import('node:fs/promises');
    const tmp = path.join(fixturesDir, '__bad_tool2.json');
    await fs.writeFile(tmp, JSON.stringify({
      name: 'X',
      tools: [{ name: 'broken', description: 'd', code: 'x', file: 'y' }],
    }));
    try {
      await expect(loadConfig(tmp)).rejects.toThrow(/exactly one of "code" or "file"/);
    } finally {
      await fs.unlink(tmp);
    }
  });

  it('rejects skills with neither content nor dir', async () => {
    const fs = await import('node:fs/promises');
    const tmp = path.join(fixturesDir, '__bad_skill.json');
    await fs.writeFile(tmp, JSON.stringify({
      name: 'X',
      skills: [{ name: 's', description: 'd' }],
    }));
    try {
      await expect(loadConfig(tmp)).rejects.toThrow(/content.*dir/);
    } finally {
      await fs.unlink(tmp);
    }
  });
});

describe('context-length config fields', () => {
  async function writeAndLoad(name: string, body: unknown) {
    const fs = await import('node:fs/promises');
    const tmp = path.join(fixturesDir, `__ctx_${name}.json`);
    await fs.writeFile(tmp, JSON.stringify(body));
    try {
      return await loadConfig(tmp);
    } finally {
      await fs.unlink(tmp);
    }
  }

  it('defaults maxContextLength to 262144 when omitted', async () => {
    const { config } = await writeAndLoad('default', { name: 'X' });
    expect(config.maxContextLength).toBe(262144);
    expect(config.maxContextLengthRatio).toBe(0.9);
    expect(config.contextCompression).toBe(true);
  });

  it('accepts maxContextLength as a string with k suffix', async () => {
    const { config } = await writeAndLoad('k', { name: 'X', maxContextLength: '256k' });
    expect(config.maxContextLength).toBe(256_000);
  });

  it('accepts maxContextLength as a string with m suffix', async () => {
    const { config } = await writeAndLoad('m', { name: 'X', maxContextLength: '1m' });
    expect(config.maxContextLength).toBe(1_000_000);
  });

  it('accepts maxContextLength as a raw integer', async () => {
    const { config } = await writeAndLoad('int', { name: 'X', maxContextLength: 100000 });
    expect(config.maxContextLength).toBe(100000);
  });

  it('accepts uppercase K and surrounding whitespace', async () => {
    const { config } = await writeAndLoad('ws', { name: 'X', maxContextLength: ' 256K ' });
    expect(config.maxContextLength).toBe(256_000);
  });

  it('rejects malformed strings with a clear error', async () => {
    await expect(writeAndLoad('bad', { name: 'X', maxContextLength: '256X' })).rejects.toThrow(
      /invalid context length "256X"/,
    );
  });

  it('rejects empty string', async () => {
    await expect(writeAndLoad('empty', { name: 'X', maxContextLength: '' })).rejects.toThrow();
  });

  it('rejects ratio above 0.99', async () => {
    await expect(writeAndLoad('ratiohi', { name: 'X', maxContextLengthRatio: 1.5 })).rejects.toThrow();
  });

  it('rejects ratio below 0.1', async () => {
    await expect(writeAndLoad('ratiolo', { name: 'X', maxContextLengthRatio: 0 })).rejects.toThrow();
  });

  it('accepts contextCompression: false', async () => {
    const { config } = await writeAndLoad('off', { name: 'X', contextCompression: false });
    expect(config.contextCompression).toBe(false);
  });
});