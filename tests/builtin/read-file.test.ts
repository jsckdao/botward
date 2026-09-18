import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
// Side-effect: registers the read_file factory with the registry.
import '../../src/tools/builtin/tools/read-file.js';
import { getBuiltinTool } from '../../src/tools/builtin/registry.js';

const tmpDir = path.resolve('tests/fixtures/__read_file');

beforeEach(async () => {
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.writeFile(path.join(tmpDir, 'allowed.txt'), 'hello world');
  await fs.writeFile(path.join(tmpDir, 'secret.txt'), 'top secret');
  await fs.writeFile(path.join(tmpDir, 'data.json'), '{"x":1}');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('read_file builtin', () => {
  it('denies when no permission is set', async () => {
    const tool = getBuiltinTool('read_file');
    await expect(
      tool.run({ path: path.join(tmpDir, 'allowed.txt') }),
    ).rejects.toThrow(/denied/);
  });

  it('reads when path matches the permission glob', async () => {
    const tool = getBuiltinTool('read_file', {
      expression: path.join(tmpDir, '*.txt'),
      extraPatterns: [],
    });
    const result = await tool.run({ path: path.join(tmpDir, 'allowed.txt') });
    expect(result).toMatchObject({
      ok: true,
      content: 'hello world',
      bytes: 11,
    });
  });

  it('denies when path does not match', async () => {
    const tool = getBuiltinTool('read_file', {
      expression: path.join(tmpDir, 'allowed.txt'),
      extraPatterns: [],
    });
    await expect(
      tool.run({ path: path.join(tmpDir, 'secret.txt') }),
    ).rejects.toThrow(/denied/);
  });

  it('honors permissionFile extraPatterns', async () => {
    const tool = getBuiltinTool('read_file', {
      expression: undefined,
      extraPatterns: [path.join(tmpDir, '*.json')],
    });
    const result = await tool.run({ path: path.join(tmpDir, 'data.json') });
    expect(result).toMatchObject({ ok: true, content: '{"x":1}' });
  });

  it('OR-combines expression and extraPatterns', async () => {
    const tool = getBuiltinTool('read_file', {
      expression: path.join(tmpDir, '*.txt'),
      extraPatterns: [path.join(tmpDir, '*.json')],
    });
    expect((await tool.run({ path: path.join(tmpDir, 'allowed.txt') })).ok).toBe(true);
    expect((await tool.run({ path: path.join(tmpDir, 'data.json') })).ok).toBe(true);
    // File with neither matching extension is denied.
    await fs.writeFile(path.join(tmpDir, 'other.md'), '# heading');
    await expect(
      tool.run({ path: path.join(tmpDir, 'other.md') }),
    ).rejects.toThrow(/denied/);
  });

  it('supports base64 encoding', async () => {
    const tool = getBuiltinTool('read_file', {
      expression: path.join(tmpDir, '*'),
      extraPatterns: [],
    });
    const result = await tool.run({
      path: path.join(tmpDir, 'allowed.txt'),
      encoding: 'base64',
    });
    expect(result).toMatchObject({
      content: Buffer.from('hello world').toString('base64'),
    });
  });

  it('throws if path is missing', async () => {
    const tool = getBuiltinTool('read_file', {
      expression: '*',
      extraPatterns: [],
    });
    await expect(tool.run({})).rejects.toThrow(/required/);
  });

  it('agent-loop overrides win over factory-closure permissions', async () => {
    // First arg wins over tool.permissions (allows runtime override).
    const tool = getBuiltinTool('read_file', {
      expression: path.join(tmpDir, 'secret.txt'),
      extraPatterns: [],
    });
    await expect(
      tool.run({ path: path.join(tmpDir, 'allowed.txt') }, undefined),
    ).rejects.toThrow(/denied/);
  });
});