import fs from 'node:fs/promises';
import { resolveFromConfig } from '../../config/paths.js';
import { BotwardError } from '../../utils/errors.js';

const PERMISSION_FILE_MAX_BYTES = 1_000_000;

export interface ResolvedPermissions {
  /** The single inline expression from `cfg.permission`. */
  expression?: string;
  /** Extra patterns parsed from `permissionFile` (JSON array of strings). */
  extraPatterns: string[];
  /** Absolute path to the permission file, for tools that want to read it themselves. */
  filePath?: string;
}

/**
 * Parse `permission` (string) and `permissionFile` (path to JSON array of
 * strings) into a single payload that gets attached to LoadedTool.permissions.
 *
 * Returns undefined when neither field is set — builtin tools then apply
 * their per-tool default policy.
 *
 * Errors are loud on purpose: a misconfigured permission file should fail
 * the botward invocation, not silently grant all-access.
 */
export async function resolvePermissions(
  cfg: { permission?: string; permissionFile?: string },
  configDir: string,
): Promise<ResolvedPermissions | undefined> {
  if (cfg.permission === undefined && cfg.permissionFile === undefined) {
    return undefined;
  }
  const out: ResolvedPermissions = { extraPatterns: [] };

  if (cfg.permission !== undefined) {
    if (typeof cfg.permission !== 'string' || cfg.permission.length === 0) {
      throw new BotwardError('tool "permission" must be a non-empty string');
    }
    out.expression = cfg.permission;
  }

  if (cfg.permissionFile !== undefined) {
    if (typeof cfg.permissionFile !== 'string' || cfg.permissionFile.length === 0) {
      throw new BotwardError('tool "permissionFile" must be a non-empty string');
    }
    const abs = resolveFromConfig(configDir, cfg.permissionFile);
    out.filePath = abs;

    let raw: string;
    try {
      const stat = await fs.stat(abs);
      if (stat.size > PERMISSION_FILE_MAX_BYTES) {
        throw new BotwardError(
          `permissionFile ${abs} exceeds ${PERMISSION_FILE_MAX_BYTES} bytes`,
        );
      }
      raw = await fs.readFile(abs, 'utf-8');
    } catch (err) {
      if (err instanceof BotwardError) throw err;
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new BotwardError(`permissionFile not found: ${abs}`);
      }
      throw new BotwardError(
        `failed to read permissionFile: ${(err as Error).message}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new BotwardError(
        `permissionFile ${abs} is not valid JSON: ${(err as Error).message}`,
      );
    }
    if (
      !Array.isArray(parsed) ||
      !parsed.every((s) => typeof s === 'string')
    ) {
      throw new BotwardError(
        `permissionFile ${abs} must be a JSON array of strings`,
      );
    }
    out.extraPatterns = parsed as string[];
  }

  return out;
}