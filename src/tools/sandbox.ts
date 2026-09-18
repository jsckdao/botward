import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BotwardError } from '../utils/errors.js';

// Re-exported here so consumers of LoadedTool don't have to chase a separate
// import path. The type itself lives in builtin/permissions.ts.
export type { ResolvedPermissions } from './builtin/permissions.js';
import type { ResolvedPermissions } from './builtin/permissions.js';

/**
 * A loaded tool: a metadata object plus an async run() function that takes
 * validated args and returns a JSON-serializable result.
 *
 * The second arg to `run` is the resolved permission payload (expression +
 * extraPatterns + filePath). User-defined tools ignore it (their function
 * takes one arg). Built-in tools enforce their own permission policy.
 */
export interface LoadedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>, permissions?: ResolvedPermissions) => Promise<unknown>;
  maxOutputBytes: number;
  timeoutMs: number;
  /** Set on built-in tools; absent on most user tools. */
  permissions?: ResolvedPermissions;
}

interface ExportedTool {
  name?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  run?: (args: Record<string, unknown>) => unknown;
  default?: (args: Record<string, unknown>) => unknown;
}

/**
 * Compile a piece of CommonJS source into a sandbox, return what was assigned
 * to `module.exports`. The sandbox exposes a real `require` rooted at
 * `filename`, so user code can do `require('axios')`, `require('fs')`, etc.
 *
 * Why vm + createRequire:
 *  - `new Function()` cannot require(); user code would have to roll its own.
 *  - `createRequire` delegates builtin + node_modules resolution to Node,
 *    so we don't reinvent it.
 */
export function loadCjsSource(
  source: string,
  filename: string,
  opts: { compileTimeoutMs?: number } = {},
): unknown {
  const compileTimeout = opts.compileTimeoutMs ?? 10_000;

  const moduleObj = { exports: {} as unknown };
  // Require rooted at `filename` so relative paths in user code work.
  const requireFn = createRequire(filename);

  const sandbox: Record<string, unknown> = {
    module: moduleObj,
    exports: moduleObj.exports,
    require: requireFn,
    __filename: filename,
    __dirname: path.dirname(filename),
    process,
    console,
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
  };

  const context = vm.createContext(sandbox);
  let script: vm.Script;
  try {
    script = new vm.Script(source, { filename });
    script.runInContext(context, { timeout: compileTimeout });
  } catch (err) {
    throw new BotwardError(
      `failed to compile tool at ${filename}: ${(err as Error).message}`,
      { cause: err },
    );
  }
  return moduleObj.exports;
}

/**
 * Take whatever a CJS module assigned to module.exports and normalize it into
 * a LoadedTool. Accepted shapes:
 *   module.exports = async (args) => {...}                  // default form
 *   module.exports = { name, description, run, inputSchema} // metadata form
 *   module.exports = { default: async (args) => {...} }     // ESM-like default
 */
export function normalizeToolExport(
  exported: unknown,
  fallbackName: string,
  fallbackDescription: string,
  fallbackInputSchema: Record<string, unknown>,
): LoadedTool {
  // Direct function
  if (typeof exported === 'function') {
    return {
      name: fallbackName,
      description: fallbackDescription,
      inputSchema: fallbackInputSchema,
      run: wrapRunFunction(exported),
      maxOutputBytes: 50_000,
      timeoutMs: 30_000,
    };
  }

  // Object form (with or without default)
  if (exported && typeof exported === 'object') {
    const obj = exported as ExportedTool;
    const fn = obj.run ?? obj.default;
    if (typeof fn !== 'function') {
      throw new BotwardError(
        `tool "${fallbackName}" export must include a run() or default() function`,
      );
    }
    return {
      name: obj.name ?? fallbackName,
      description: obj.description ?? fallbackDescription,
      inputSchema: obj.inputSchema ?? fallbackInputSchema,
      run: wrapRunFunction(fn),
      maxOutputBytes: 50_000,
      timeoutMs: 30_000,
    };
  }

  throw new BotwardError(
    `tool "${fallbackName}" must export a function or { run } object; got ${typeof exported}`,
  );
}

function wrapRunFunction(fn: unknown): LoadedTool['run'] {
  if (typeof fn !== 'function') {
    throw new BotwardError('tool run must be a function');
  }
  // Returned value may be a Promise — just await it. If the user throws,
  // the agent loop catches it and reports isError to the LLM.
  // User tools ignore the second `permissions` arg; built-in tools use it.
  return async (args, _perms) => (fn as (a: unknown) => unknown)(args);
}