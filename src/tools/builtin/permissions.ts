import fs from 'node:fs/promises';
import { resolveFromConfig } from '../../config/paths.js';
import { BotwardError } from '../../utils/errors.js';

const PERMISSION_FILE_MAX_BYTES = 1_000_000;

export interface ResolvedPermissions {
  /**
   * The first inline expression from `cfg.permission`. Kept singular so that
   * downstream consumers (e.g. user-defined tools) can still treat the
   * primary allowlist as a single string. When `cfg.permission` is a string
   * array, the first element lands here and the rest fall into
   * `extraPatterns`.
   */
  expression?: string;
  /** Extra patterns: extra array entries from `cfg.permission`, plus all `permissionFile` entries. */
  extraPatterns: string[];
  /** Absolute path to the permission file, for tools that want to read it themselves. */
  filePath?: string;
}

/**
 * Parse `permission` (string or string[]) and `permissionFile` (path to JSON
 * array of strings) into a single payload that gets attached to
 * LoadedTool.permissions.
 *
 * `permission` accepts:
 *   - a single string: that one expression becomes `expression`
 *   - a string array: the first element becomes `expression`, the rest go
 *     into `extraPatterns` (and merge with `permissionFile` entries by OR).
 *
 * Returns undefined when neither field is set — builtin tools then apply
 * their per-tool default policy.
 *
 * Errors are loud on purpose: a misconfigured permission should fail the
 * botward invocation, not silently grant all-access.
 */
export async function resolvePermissions(
  cfg: { permission?: string | string[]; permissionFile?: string },
  configDir: string,
): Promise<ResolvedPermissions | undefined> {
  if (cfg.permission === undefined && cfg.permissionFile === undefined) {
    return undefined;
  }
  const out: ResolvedPermissions = { extraPatterns: [] };

  if (cfg.permission !== undefined) {
    const list = Array.isArray(cfg.permission) ? cfg.permission : [cfg.permission];
    if (list.length === 0 || list.some((s) => typeof s !== 'string' || s.length === 0)) {
      throw new BotwardError(
        'tool "permission" must be a non-empty string or a non-empty array of non-empty strings',
      );
    }
    out.expression = list[0];
    if (list.length > 1) {
      out.extraPatterns.push(...list.slice(1));
    }
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
    out.extraPatterns.push(...(parsed as string[]));
  }

  return out;
}