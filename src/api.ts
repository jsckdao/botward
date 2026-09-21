import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './config/loader.js';
import { loadSkills } from './skills/loader.js';
import { loadTools } from './tools/loader.js';
import { createLLMClient, type ClientOptions } from './llm/factory.js';
import { composeSystemPrompt } from './agent/prompt.js';
import { runAgent, type AgentRunResult } from './agent/loop.js';
import {
  runInit,
  buildInitConfig,
  envDefaultModel,
} from './cli/commands/init.js';
import type { LLMClient } from './llm/types.js';
import type { Config, Provider } from './config/schema.js';
import { BotwardError } from './utils/errors.js';
import { logger } from './utils/logger.js';

/**
 * Provider entry in the Botward constructor.
 *
 * Fields are all optional except `type`. Resolution precedence (high to low):
 *   1. per-call override on `init({ provider, model })`
 *   2. this entry's apiKey / baseUrl / model
 *   3. env vars (ANTHROPIC_API_KEY, OPENAI_API_KEY, *_BASE_URL, BOTWARD_MODEL_*)
 *   4. SDK defaults
 */
export interface BotwardProviderConfig {
  type: 'anthropic' | 'openai';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface BotwardOptions {
  /** At least one. Duplicate `type` is rejected — use `model` to differentiate. */
  providers: BotwardProviderConfig[];
  /** Working directory for relative config / output paths. Defaults to process.cwd(). */
  cwd?: string;
  /**
   * Override the LLM client factory. Tests use this to inject a scripted LLM
   * without network. Returns the LLMClient to use (or null/undefined to fall
   * back to the default factory).
   */
  llmFactory?: (config: Config, opts: ClientOptions) => LLMClient | null | undefined;
}

export interface ExecuteOptions {
  /** Path to a `botward.json`. Relative paths resolve against `cwd`. */
  config: string;
}

export interface InitOptions {
  /** Path for the main config file. Its directory becomes the project root. */
  output: string;
  /** Force a specific provider type. Must match a constructor entry. */
  provider?: Provider;
  /** Override the model name passed to the LLM. */
  model?: string;
}

export interface InitResult {
  result: AgentRunResult;
  outputPath: string;
  outputDir: string;
  provider: Provider;
  model: string | undefined;
}

interface ResolvedProvider {
  type: Provider;
  apiKey: string | undefined;
  baseURL: string | undefined;
  model: string | undefined;
}

interface InitProviderPick {
  provider: Provider;
  model: string | undefined;
}

const VALID_TYPES: ReadonlySet<Provider> = new Set(['anthropic', 'openai']);

/**
 * Library entry. Same engine as the CLI, but no stdout side effects and no
 * `process.exit` — call `.execute()` / `.init()` and inspect the return value.
 *
 * Errors are `BotwardError` so callers can filter with `instanceof`.
 *
 * Example:
 *   import Botward from 'botward';
 *   const botward = new Botward({ providers: [{ type: 'anthropic', apiKey: '...' }] });
 *   const { finalText } = await botward.execute('summarize', { config: 'botward.json' });
 */
export class Botward {
  private readonly providers: ResolvedProvider[];
  private readonly cwd: string;
  private readonly llmFactory: NonNullable<BotwardOptions['llmFactory']>;

  constructor(opts: BotwardOptions) {
    if (!opts.providers || opts.providers.length === 0) {
      throw new BotwardError('Botward requires at least one provider in `providers`');
    }
    this.cwd = opts.cwd ?? process.cwd();
    this.providers = resolveProviders(opts.providers);
    // Default factory: bundled createLLMClient. Tests override this.
    this.llmFactory = opts.llmFactory ?? ((cfg, o) => createLLMClient(cfg, o));
  }

  async execute(task: string, options: ExecuteOptions): Promise<AgentRunResult> {
    const configPath = path.isAbsolute(options.config)
      ? path.normalize(options.config)
      : path.resolve(this.cwd, options.config);

    const { config, configDir } = await loadConfig(configPath);
    logger.info(`config "${config.name}" (provider=${config.provider})`);

    const llm = this.resolveConfigLlm(config);
    const skills = await loadSkills(config.skills, configDir);
    const tools = await loadTools(config.tools, configDir);
    const system = composeSystemPrompt(config, skills, tools.map((t) => t.name));

    return runAgent(task, { llm, tools, config, system });
  }

  async init(requirements: string, options: InitOptions): Promise<InitResult> {
    if (!requirements || requirements.trim().length === 0) {
      throw new BotwardError('init requires a non-empty requirements description');
    }

    const pick = pickInitProvider(this.providers, options);

    const outputPath = path.isAbsolute(options.output)
      ? path.normalize(options.output)
      : path.resolve(this.cwd, options.output);
    const outputDir = path.dirname(outputPath);

    // Auto-mkdir the project root so list_files sees a real directory.
    await fs.mkdir(outputDir, { recursive: true });

    const config = buildInitConfig({
      outputPath,
      outputDir,
      provider: pick.provider,
      model: pick.model,
    });
    const llm = this.llmFactory(config, {}) ?? createLLMClient(config);
    const { result } = await runInit({ requirements, outputPath, outputDir, llm });

    // Fail loud if the model bailed before writing the main config.
    try {
      await fs.access(outputPath);
    } catch {
      throw new BotwardError(
        `init finished without creating ${outputPath}. The model's last response was:\n${result.finalText}`,
      );
    }

    return { result, outputPath, outputDir, provider: pick.provider, model: pick.model };
  }

  /**
   * Look up the constructor provider entry whose `type` matches `config.provider`,
   * then pass its fields as opts to the LLM factory. If no matching entry exists
   * we pass empty opts — the factory's env-var fallback still works.
   */
  private resolveConfigLlm(config: Config): LLMClient {
    const entry = this.providers.find((p) => p.type === config.provider);
    const opts: ClientOptions = entry
      ? {
          apiKey: entry.apiKey,
          baseURL: entry.baseURL,
          model: entry.model,
        }
      : {};
    return this.llmFactory(config, opts) ?? createLLMClient(config, opts);
  }
}

export default Botward;

// -----------------------------------------------------------------------------
// Internal helpers (not exported) — kept in this file for proximity to the class.
// -----------------------------------------------------------------------------

function resolveProviders(list: BotwardProviderConfig[]): ResolvedProvider[] {
  const seen = new Set<Provider>();
  const out: ResolvedProvider[] = [];
  for (let i = 0; i < list.length; i++) {
    const raw = list[i]!;
    if (!VALID_TYPES.has(raw.type as Provider)) {
      throw new BotwardError(
        `providers[${i}].type must be "anthropic" or "openai", got "${raw.type}"`,
      );
    }
    const type = raw.type as Provider;
    if (seen.has(type)) {
      throw new BotwardError(
        `providers[${i}] duplicates type "${type}". Pass a single entry per type; use \`model\` to differentiate.`,
      );
    }
    seen.add(type);
    out.push({
      type,
      apiKey: raw.apiKey,
      baseURL: raw.baseUrl,
      model: raw.model,
    });
  }
  return out;
}

/**
 * Algorithm (in priority order):
 *   1. `options.provider` explicit — must match a constructor entry. Use
 *      `options.model ?? entry.model ?? envDefaultModel()`.
 *   2. Otherwise, walk constructor entries; first with non-empty `apiKey` wins.
 *   3. If no entry has apiKey, fall back to env (`ANTHROPIC_API_KEY` /
 *      `OPENAI_API_KEY`) — pick the first entry whose type matches an env var.
 *   4. Throw.
 */
function pickInitProvider(
  providers: ResolvedProvider[],
  options: InitOptions,
): InitProviderPick {
  if (options.provider !== undefined) {
    const entry = providers.find((p) => p.type === options.provider);
    if (!entry) {
      throw new BotwardError(
        `init called with provider="${options.provider}" but no matching entry in providers[]`,
      );
    }
    const model = options.model ?? entry.model ?? envDefaultModel(entry.type);
    return { provider: entry.type, model };
  }

  // No explicit provider — first entry with a usable key wins.
  for (const entry of providers) {
    if (entry.apiKey && entry.apiKey.length > 0) {
      const model = options.model ?? entry.model ?? envDefaultModel(entry.type);
      return { provider: entry.type, model };
    }
  }

  // No entry has an apiKey — try env fallback.
  if (process.env.ANTHROPIC_API_KEY) {
    const entry = providers.find((p) => p.type === 'anthropic');
    if (entry) {
      return {
        provider: 'anthropic',
        model: options.model ?? entry.model ?? envDefaultModel('anthropic'),
      };
    }
  }
  if (process.env.OPENAI_API_KEY) {
    const entry = providers.find((p) => p.type === 'openai');
    if (entry) {
      return {
        provider: 'openai',
        model: options.model ?? entry.model ?? envDefaultModel('openai'),
      };
    }
  }

  throw new BotwardError(
    'init needs an LLM. Pass providers[] with apiKey, set ANTHROPIC_API_KEY/OPENAI_API_KEY, or pass --provider.',
  );
}