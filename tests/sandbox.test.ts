import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { loadCjsSource, normalizeToolExport } from '../src/tools/sandbox.js';

const filename = path.resolve('tests/fixtures/__sandbox.cjs');

describe('loadCjsSource', () => {
  it('compiles and runs a module that exports a function', () => {
    const exp = loadCjsSource(
      'module.exports = function echo(args) { return { ok: args.msg }; };',
      filename,
    );
    const tool = normalizeToolExport(exp, 'echo', '', {});
    expect(tool.name).toBe('echo');
  });

  it('supports require() of builtin modules', async () => {
    const exp = loadCjsSource(
      `const path = require('node:path');
       module.exports = async () => path.basename(__filename);`,
      filename,
    );
    const tool = normalizeToolExport(exp, 't', '', {});
    const result = await tool.run({});
    expect(result).toBe('__sandbox.cjs');
  });

  it('supports async exports', async () => {
    const exp = loadCjsSource(
      'module.exports = async ({ a, b }) => ({ sum: a + b });',
      filename,
    );
    const tool = normalizeToolExport(exp, 'add', '', {});
    expect(await tool.run({ a: 2, b: 3 })).toEqual({ sum: 5 });
  });

  it('handles { run } object form', async () => {
    const exp = loadCjsSource(
      'module.exports = { name: "x", description: "y", run: ({n}) => n*2 };',
      filename,
    );
    const tool = normalizeToolExport(exp, 'fallback', '', {});
    expect(tool.name).toBe('x');
    expect(tool.description).toBe('y');
    expect(await tool.run({ n: 21 })).toBe(42);
  });

  it('handles { default } object form', async () => {
    const exp = loadCjsSource(
      'module.exports = { default: ({n}) => n*3 };',
      filename,
    );
    const tool = normalizeToolExport(exp, 't', '', {});
    expect(await tool.run({ n: 14 })).toBe(42);
  });

  it('propagates compile errors', () => {
    expect(() =>
      loadCjsSource('this is not valid javascript !!!', filename),
    ).toThrow(/failed to compile/);
  });

  it('rejects exports that are neither function nor object', () => {
    const exp = loadCjsSource('module.exports = 42;', filename);
    expect(() => normalizeToolExport(exp, 't', '', {})).toThrow(
      /must export a function or { run }/,
    );
  });
});