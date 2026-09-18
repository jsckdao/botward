import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import '../../src/tools/builtin/tools/write-file.js';
import { getBuiltinTool } from '../../src/tools/builtin/registry.js';

const tmpDir = path.resolve('tests/fixtures/__write_file');

beforeEach(async () => {
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('write_file builtin', () => {
  it('denies when no permission is set', async () => {
    const tool = getBuiltinTool('write_file');
    await expect(
      tool.run({ path: path.join(tmpDir, 'x.txt'), content: 'hi' }),
    ).rejects.toThrow(/denied/);
  });

  it('writes a file when allowed', async () => {
    const tool = getBuiltinTool('write_file', {
      expression: path.join(tmpDir, '*.txt'),
      extraPatterns: [],
    });
    const result = await tool.run({
      path: path.join(tmpDir, 'hello.txt'),
      content: 'world',
    });
    expect(result).toMatchObject({ ok: true });
    const actual = await fs.readFile(path.join(tmpDir, 'hello.txt'), 'utf-8');
    expect(actual).toBe('world');
  });

  it('appends when mode=append', async () => {
    const file = path.join(tmpDir, 'log.txt');
    await fs.writeFile(file, 'line1\n');
    const tool = getBuiltinTool('write_file', {
      expression: path.join(tmpDir, '*'),
      extraPatterns: [],
    });
    await tool.run({ path: file, content: 'line2\n', mode: 'append' });
    expect(await fs.readFile(file, 'utf-8')).toBe('line1\nline2\n');
  });

  it('creates intermediate directories on overwrite', async () => {
    const tool = getBuiltinTool('write_file', {
      expression: path.join(tmpDir, '**/*'),
      extraPatterns: [],
    });
    await tool.run({
      path: path.join(tmpDir, 'nested/dir/file.txt'),
      content: 'nested',
    });
    expect(
      await fs.readFile(path.join(tmpDir, 'nested/dir/file.txt'), 'utf-8'),
    ).toBe('nested');
  });

  it('rejects content exceeding the size cap', async () => {
    const tool = getBuiltinTool('write_file', {
      expression: '*',
      extraPatterns: [],
    });
    await expect(
      tool.run({ path: 'x.txt', content: 'a'.repeat(6_000_000) }),
    ).rejects.toThrow(/exceeds/);
  });
});