import path from 'node:path';
import { BotwardError } from '../utils/errors.js';

/**
 * Resolve a path that may be relative. Relative paths are anchored at
 * `fromDir` (typically the directory of the config file), NOT process.cwd().
 * This matters when `botward serve` is invoked from a different cwd.
 */
export function resolveFromConfig(fromDir: string, p: string): string {
  if (path.isAbsolute(p)) return path.normalize(p);
  return path.resolve(fromDir, p);
}

export function ensureAbsolute(filePath: string, fromDir: string): string {
  try {
    return resolveFromConfig(fromDir, filePath);
  } catch (err) {
    throw new BotwardError(`invalid path "${filePath}": ${(err as Error).message}`);
  }
}