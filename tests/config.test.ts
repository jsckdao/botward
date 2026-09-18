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