import { loadCjsSource, normalizeToolExport } from '../src/tools/sandbox.js';
import { loadTools } from '../src/tools/loader.js';
import path from 'node:path';
import fs from 'node:fs/promises';

// 1. Sandbox: inline CJS that uses require('node:path')
const filename = path.resolve('tests/fixtures/smoke-inline-tool.cjs');
const source = `
  const path = require('node:path');
  module.exports = async ({ a, b }) => ({
    sum: a + b,
    here: path.basename(__filename),
  });
`;
const exported = loadCjsSource(source, filename);
const tool1 = normalizeToolExport(exported, 'adder', 'add two numbers', {});
const r1 = await tool1.run({ a: 2, b: 3 });
console.log('inline tool:', r1);

// 2. Sandbox: function form (not wrapped in module.exports)
const exported2 = loadCjsSource(
  'module.exports = function syncEcho(args) { return { ok: true, msg: args.msg }; };',
  path.resolve('tests/fixtures/smoke-fn.cjs'),
);
const tool2 = normalizeToolExport(exported2, 'echo', 'echo', {});
const r2 = await tool2.run({ msg: 'hi' });
console.log('function form:', r2);

// 3. Loader: external file (tests/fixtures/sample-tool.cjs)
await fs.writeFile(
  'tests/fixtures/sample-tool.cjs',
  'module.exports = { name: "sample", run: async ({x}) => ({doubled: x*2}) };',
);
const tools = await loadTools(
  [
    {
      name: 'sample',
      description: 'doubles a number',
      inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
      file: 'sample-tool.cjs',
    },
  ],
  path.resolve('tests/fixtures'),
);
const r3 = await tools[0]!.run({ x: 21 });
console.log('file-loaded tool:', r3);