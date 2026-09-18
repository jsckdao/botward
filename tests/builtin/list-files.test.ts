import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import '../../src/tools/builtin/tools/list-files.js';
import { getBuiltinTool } from '../../src/tools/builtin/registry.js';

const tmpDir = path.resolve('tests/fixtures/__list_files');

beforeEach(async () => {
  await fs.mkdir(path.join(tmpDir, 'sub'), { recursive: true });
  await fs.writeFile(path.join(tmpDir, 'a.txt'), '');
  await fs.writeFile(path.join(tmpDir, 'b.js'), '');
  await fs.writeFile(path.join(tmpDir, 'sub/c.ts'), '');
  await fs.writeFile(path.join(tmpDir, 'sub/d.txt'), '');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('list_files builtin', () => {
  it('denies when no permission is set', async () => {
    const tool = getBuiltinTool('list_files');
    await expect(tool.run({ cwd: tmpDir })).rejects.toThrow(/denied/);
  });

  it('lists files matching the glob', async () => {
    const tool = getBuiltinTool('list_files', {
      expression: path.join(tmpDir, '**'),
      extraPatterns: [],
    });
    const result = await tool.run({ cwd: tmpDir, pattern: '**/*.txt' });
    expect(result.ok).toBe(true);
    const files = (result as any).files as string[];
    expect(files.length).toBe(2);
    expect(files.some((f) => f.endsWith('a.txt'))).toBe(true);
    expect(files.some((f) => f.endsWith('d.txt'))).toBe(true);
  });

  it('lists everything with default pattern', async () => {
    const tool = getBuiltinTool('list_files', {
      expression: path.join(tmpDir, '**'),
      extraPatterns: [],
    });
    const result = await tool.run({ cwd: tmpDir });
    expect((result as any).files.length).toBe(4);
  });

  it('respects limit', async () => {
    const tool = getBuiltinTool('list_files', {
      expression: path.join(tmpDir, '**'),
      extraPatterns: [],
    });
    const result = await tool.run({ cwd: tmpDir, limit: 2 });
    expect((result as any).files.length).toBe(2);
  });
});