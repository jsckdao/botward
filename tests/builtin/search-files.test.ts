import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import '../../src/tools/builtin/tools/search-files.js';
import { getBuiltinTool } from '../../src/tools/builtin/registry.js';

const tmpDir = path.resolve('tests/fixtures/__search_files');

beforeEach(async () => {
  await fs.mkdir(path.join(tmpDir, 'sub'), { recursive: true });
  await fs.writeFile(path.join(tmpDir, 'a.txt'), 'hello world\nfoo bar\n');
  await fs.writeFile(path.join(tmpDir, 'b.js'), 'const hello = 1\n');
  await fs.writeFile(path.join(tmpDir, 'sub/c.txt'), 'goodbye\n');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('search_files builtin', () => {
  it('denies when no permission is set', async () => {
    const tool = getBuiltinTool('search_files');
    await expect(tool.run({ pattern: 'x', cwd: tmpDir })).rejects.toThrow(/denied/);
  });

  it('finds substring matches across files', async () => {
    const tool = getBuiltinTool('search_files', {
      expression: path.join(tmpDir, '**'),
      extraPatterns: [],
    });
    const result = await tool.run({ pattern: 'hello', cwd: tmpDir });
    const matches = (result as any).matches as Array<{ file: string; line: number; text: string }>;
    expect(matches.length).toBe(2);
    expect(matches.some((m) => m.file.endsWith('a.txt') && m.line === 1)).toBe(true);
    expect(matches.some((m) => m.file.endsWith('b.js') && m.line === 1)).toBe(true);
  });

  it('is case-sensitive by default', async () => {
    const tool = getBuiltinTool('search_files', {
      expression: path.join(tmpDir, '**'),
      extraPatterns: [],
    });
    const result = await tool.run({ pattern: 'HELLO', cwd: tmpDir });
    expect((result as any).matches.length).toBe(0);

    const result2 = await tool.run({ pattern: 'HELLO', cwd: tmpDir, caseSensitive: false });
    expect((result2 as any).matches.length).toBe(2);
  });

  it('supports regex pattern', async () => {
    const tool = getBuiltinTool('search_files', {
      expression: path.join(tmpDir, '**'),
      extraPatterns: [],
    });
    const result = await tool.run({
      pattern: 'hello|goodbye',
      cwd: tmpDir,
      regex: true,
    });
    const matches = (result as any).matches as Array<{ file: string }>;
    expect(matches.length).toBe(3);
  });

  it('honors glob to limit which files are scanned', async () => {
    const tool = getBuiltinTool('search_files', {
      expression: path.join(tmpDir, '**'),
      extraPatterns: [],
    });
    const result = await tool.run({
      pattern: 'hello',
      cwd: tmpDir,
      glob: '**/*.txt',
    });
    const matches = (result as any).matches as Array<{ file: string }>;
    expect(matches.length).toBe(1);
    expect(matches[0]!.file.endsWith('a.txt')).toBe(true);
  });

  it('respects maxResults', async () => {
    const tool = getBuiltinTool('search_files', {
      expression: path.join(tmpDir, '**'),
      extraPatterns: [],
    });
    const result = await tool.run({ pattern: 'hello', cwd: tmpDir, maxResults: 1 });
    const r = result as any;
    expect(r.matches.length).toBe(1);
    expect(r.truncated).toBe(true);
  });

  it('rejects empty pattern', async () => {
    const tool = getBuiltinTool('search_files', {
      expression: path.join(tmpDir, '**'),
      extraPatterns: [],
    });
    await expect(tool.run({ pattern: '', cwd: tmpDir })).rejects.toThrow(/required/);
  });
});