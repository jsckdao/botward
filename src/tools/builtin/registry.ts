import type { LoadedTool, ResolvedPermissions } from '../sandbox.js';

/**
 * Set of tool names that botward provides out of the box. Used by the schema
 * to relax the "code XOR file" refine for builtin tools, and by the loader
 * to dispatch builtin names to their factory instead of the CJS sandbox.
 *
 * Adding a new builtin: append its name here AND register a factory via
 * `registerBuiltin()`. Schema will accept a tool with no `code`/`file` if
 * its name appears in here.
 *
 * NOTE: side-effect imports for each tool's factory file live in
 * `registry-imports.ts`. They cannot live here because tool modules call
 * `registerBuiltin()` at top level, which means they must execute AFTER
 * registry.ts's body has run — and ES module imports are hoisted.
 */
export const BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set([
  'read_file',
  'write_file',
  'list_files',
  'search_files',
  'fetch_url',
  'run_command',
]);

export type BuiltinFactory = (permissions?: ResolvedPermissions) => LoadedTool;

const factories = new Map<string, BuiltinFactory>();

export function registerBuiltin(name: string, factory: BuiltinFactory): void {
  if (!BUILTIN_TOOL_NAMES.has(name)) {
    throw new Error(
      `registerBuiltin: "${name}" is not in BUILTIN_TOOL_NAMES — add it there first`,
    );
  }
  if (factories.has(name)) {
    throw new Error(`registerBuiltin: "${name}" is registered twice`);
  }
  factories.set(name, factory);
}

export function getBuiltinTool(
  name: string,
  permissions?: ResolvedPermissions,
): LoadedTool {
  const factory = factories.get(name);
  if (!factory) {
    throw new Error(
      `builtin tool "${name}" is declared but not registered (check that its factory file is imported)`,
    );
  }
  return factory(permissions);
}