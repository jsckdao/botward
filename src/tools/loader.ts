import fs from 'node:fs/promises';
import path from 'node:path';
import { BotwardError } from '../utils/errors.js';
import { type ToolConfig } from '../config/schema.js';
import { resolveFromConfig } from '../config/paths.js';
import { loadCjsSource, normalizeToolExport, type LoadedTool } from './sandbox.js';
import { BUILTIN_TOOL_NAMES, getBuiltinTool } from './builtin/registry.js';
import { resolvePermissions } from './builtin/permissions.js';
// Side-effect: ensure all built-in tools are registered before any lookup.
import './builtin/registry-imports.js';

/**
 * Load all tools from the config. Each tool resolves to a LoadedTool with
 * its own sandboxed run() function. Built-in names (read_file, write_file,
 * etc.) are dispatched to their factories; everything else goes through the
 * CJS sandbox.
 */
export async function loadTools(
  configs: ToolConfig[],
  configDir: string,
): Promise<LoadedTool[]> {
  const tools: LoadedTool[] = [];
  for (const cfg of configs) {
    tools.push(await loadOneTool(cfg, configDir));
  }
  return tools;
}

async function loadOneTool(cfg: ToolConfig, configDir: string): Promise<LoadedTool> {
  // Resolve permissions first — if the file is missing/malformed, fail here
  // before we touch any sandbox or builtin.
  const permissions = await resolvePermissions(cfg, configDir);

  // Built-in dispatch: bypass the CJS sandbox entirely.
  if (BUILTIN_TOOL_NAMES.has(cfg.name)) {
    const tool = getBuiltinTool(cfg.name, permissions);
    if (cfg.maxOutputBytes !== undefined) tool.maxOutputBytes = cfg.maxOutputBytes;
    if (cfg.timeoutMs !== undefined) tool.timeoutMs = cfg.timeoutMs;
    return tool;
  }

  // User-defined tool — must have code or file.
  let source: string;
  let filename: string;

  if (cfg.code !== undefined) {
    source = cfg.code;
    // Synthesize a stable filename so `require` of relative paths is sane.
    filename = path.join(configDir, `${cfg.name}.tool.cjs`);
  } else if (cfg.file !== undefined) {
    const abs = resolveFromConfig(configDir, cfg.file);
    try {
      source = await fs.readFile(abs, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new BotwardError(`tool file not found: ${abs}`);
      }
      throw new BotwardError(`failed to read tool file: ${(err as Error).message}`);
    }
    filename = abs;
  } else {
    throw new BotwardError(
      `tool "${cfg.name}" has neither "code" nor "file" and is not a built-in`,
    );
  }

  const exported = loadCjsSource(source, filename);
  const tool = normalizeToolExport(
    exported,
    cfg.name,
    cfg.description,
    cfg.inputSchema,
  );

  // Per-tool overrides from config win over defaults.
  if (cfg.maxOutputBytes !== undefined) {
    tool.maxOutputBytes = cfg.maxOutputBytes;
  }
  if (cfg.timeoutMs !== undefined) {
    tool.timeoutMs = cfg.timeoutMs;
  }
  // User tools receive permissions too, but their run function ignores them.
  if (permissions) tool.permissions = permissions;

  return tool;
}