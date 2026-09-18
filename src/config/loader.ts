import fs from 'node:fs/promises';
import path from 'node:path';
import { ConfigSchema, type Config } from './schema.js';
import { BotwardError } from '../utils/errors.js';

export interface LoadedConfig {
  config: Config;
  /** Absolute path to the directory containing the config file. */
  configDir: string;
  /** Absolute path to the loaded config file itself. */
  configPath: string;
}

/**
 * Load and validate a botward config file.
 *
 * Relative `dir` / `file` paths inside the config are NOT resolved here —
 * the loader that consumes the config will resolve them against `configDir`.
 */
export async function loadConfig(configPath: string): Promise<LoadedConfig> {
  const abs = path.isAbsolute(configPath)
    ? path.normalize(configPath)
    : path.resolve(process.cwd(), configPath);

  let raw: string;
  try {
    raw = await fs.readFile(abs, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new BotwardError(`config file not found: ${abs}`);
    }
    throw new BotwardError(`failed to read config: ${(err as Error).message}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new BotwardError(`config is not valid JSON: ${(err as Error).message}`);
  }

  const parsed = ConfigSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new BotwardError(`invalid config: ${issues}`);
  }

  return {
    config: parsed.data,
    configDir: path.dirname(abs),
    configPath: abs,
  };
}