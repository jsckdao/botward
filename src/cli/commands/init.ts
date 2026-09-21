import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config, Provider } from '../../config/schema.js';
import { loadTools } from '../../tools/loader.js';
import { createLLMClient } from '../../llm/factory.js';
import { composeSystemPrompt } from '../../agent/prompt.js';
import { runAgent, type AgentRunResult } from '../../agent/loop.js';
import type { LLMClient } from '../../llm/types.js';
import { BotwardError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { initSystemPrompt } from '../../init/prompt.js';

export interface InitOptions {
  output: string;
  provider?: string;
  model?: string;
}

/**
 * `botward init` — generate a botward project from a free-form description.
 *
 * Implementation note: this command reuses the execute flow end to end. We
 * synthesize an in-memory Config that grants the model permission to use a
 * small set of built-in tools (read/write/list/search_file) scoped to the
 * output directory, then drive `runAgent`. The model produces files via
 * write_file; multi-file output (config + tools/*.cjs + skills/*) happens
 * naturally without any special handling.
 */
export async function initCommand(
  requirements: string,
  options: InitOptions,
): Promise<void> {
  if (!requirements || requirements.trim().length === 0) {
    throw new BotwardError('init requires a non-empty requirements description');
  }

  const provider = resolveProvider(options.provider);
  const model = options.model ?? envDefaultModel(provider);

  const outputPath = path.isAbsolute(options.output)
    ? path.normalize(options.output)
    : path.resolve(process.cwd(), options.output);
  const outputDir = path.dirname(outputPath);

  // Ensure the output directory exists up front. write_file mkdir -p's
  // intermediate paths, but the root needs to exist before any list_files
  // runs (it returns [] for non-existent dirs, which is misleading).
  await fs.mkdir(outputDir, { recursive: true });

  const config = buildInitConfig({ outputPath, outputDir, provider, model });

  logger.info(`init target: ${outputPath}`);
  logger.info(`init permission scope: ${outputDir}/**`);

  const llm = createLLMClient(config);
  const { result } = await runInit({
    requirements,
    outputPath,
    outputDir,
    llm,
  });

  // Sanity-check: did the model actually create the main config? runAgent
  // exiting with finalText is not enough — the model may have decided to
  // bail out early. Surface a clear error so the user knows to retry.
  try {
    await fs.access(outputPath);
  } catch {
    throw new BotwardError(
      `init finished without creating ${outputPath}. The model's last response was:\n${result.finalText}`,
    );
  }

  // Summary to stdout (so the user can grep / pipe).
  process.stdout.write(`wrote ${outputPath}\n`);
  process.stdout.write(`  provider:    ${provider}\n`);
  if (model) process.stdout.write(`  model:       ${model}\n`);
  process.stdout.write(`  iterations:  ${result.iterations}\n`);
  process.stdout.write(`\n${result.finalText}\n`);
}

export interface RunInitOpts {
  requirements: string;
  outputPath: string;
  outputDir: string;
  llm: LLMClient;
}

export interface RunInitResult {
  result: AgentRunResult;
  config: Config;
}

/**
 * Inner init flow: synthesize a Config, load the built-in tools, and drive
 * runAgent with the given LLM. Exported for tests; initCommand wraps this
 * with provider resolution, output dir creation, and the post-run check.
 */
export async function runInit(opts: RunInitOpts): Promise<RunInitResult> {
  const { requirements, outputPath, outputDir, llm } = opts;
  const config = buildInitConfig({
    outputPath,
    outputDir,
    provider: 'anthropic',
    model: undefined,
  });
  const tools = await loadTools(config.tools, outputDir);
  const system = composeSystemPrompt(
    config,
    [],
    tools.map((t) => t.name),
  );
  const result = await runAgent(requirements, { llm, tools, config, system });
  return { result, config };
}

interface BuildConfigOpts {
  outputPath: string;
  outputDir: string;
  provider: Provider;
  model: string | undefined;
}

export function buildInitConfig(opts: BuildConfigOpts): Config {
  const { outputPath, outputDir, provider, model } = opts;
  const scope = `${outputDir}/**`;
  // Four built-ins: read+write+list+search. No fetch_url / run_command —
  // init should not make network requests or shell out.
  const toolNames = ['read_file', 'write_file', 'list_files', 'search_files'] as const;
  return {
    name: 'botward-init',
    version: '0.0.0',
    description: `Synthesized init config generating ${outputPath}`,
    provider,
    ...(model !== undefined ? { model } : {}),
    systemPrompt: initSystemPrompt({ outputPath, outputDir }),
    maxIterations: 30,
    skills: [],
    tools: toolNames.map((name) => ({
      name,
      description: '', // builtin supplies its own
      inputSchema: {},
      permission: scope,
    })),
    contextCompression: true,
    maxContextLength: 262_144,
    maxContextLengthRatio: 0.9,
  };
}

export function resolveProvider(explicit: string | undefined): Provider {
  if (explicit !== undefined) {
    if (explicit !== 'anthropic' && explicit !== 'openai') {
      throw new BotwardError(
        `invalid --provider: ${explicit} (expected "anthropic" or "openai")`,
      );
    }
    return explicit;
  }
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  throw new BotwardError(
    'init needs an LLM. Export ANTHROPIC_API_KEY or OPENAI_API_KEY, or pass --provider.',
  );
}

export function envDefaultModel(provider: Provider): string | undefined {
  return provider === 'anthropic'
    ? process.env.BOTWARD_MODEL_ANTHROPIC
    : process.env.BOTWARD_MODEL_OPENAI;
}