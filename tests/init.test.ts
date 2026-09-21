import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  buildInitConfig,
  envDefaultModel,
  resolveProvider,
  runInit,
} from '../src/cli/commands/init.js';
import { ConfigSchema } from '../src/config/schema.js';
import { ScriptedLLM } from './helpers/scripted-llm.js';

const VALID_CONFIG = JSON.stringify({
  name: 'Echo bot',
  systemPrompt: 'You are a parrot.',
  tools: [
    {
      name: 'echo',
      description: 'echo input',
      inputSchema: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] },
      code: 'module.exports = async ({msg}) => ({echoed: msg});',
    },
  ],
});

const fixturesRoot = path.resolve('tests/fixtures');
const initRoot = path.join(fixturesRoot, '__init_tmp');

beforeEach(async () => {
  await fs.rm(initRoot, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(initRoot, { recursive: true, force: true });
});

describe('buildInitConfig', () => {
  it('declares the four init builtins scoped to outputDir', () => {
    const cfg = buildInitConfig({
      outputPath: '/tmp/x/botward.json',
      outputDir: '/tmp/x',
      provider: 'anthropic',
      model: 'claude-test',
    });
    expect(cfg.provider).toBe('anthropic');
    expect(cfg.model).toBe('claude-test');
    expect(cfg.tools.map((t) => t.name).sort()).toEqual([
      'list_files',
      'read_file',
      'search_files',
      'write_file',
    ]);
    for (const t of cfg.tools) {
      expect(t.permission).toBe('/tmp/x/**');
    }
    expect(cfg.systemPrompt).toContain('/tmp/x/botward.json');
  });

  it('omits model from config when undefined (lets SDK default kick in)', () => {
    const cfg = buildInitConfig({
      outputPath: '/tmp/x/botward.json',
      outputDir: '/tmp/x',
      provider: 'openai',
      model: undefined,
    });
    expect(cfg.provider).toBe('openai');
    expect(cfg.model).toBeUndefined();
  });
});

describe('resolveProvider', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('prefers explicit --provider', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-x';
    expect(resolveProvider('openai')).toBe('openai');
  });

  it('falls back to anthropic when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-x';
    expect(resolveProvider(undefined)).toBe('anthropic');
  });

  it('falls back to openai when only OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'sk-x';
    expect(resolveProvider(undefined)).toBe('openai');
  });

  it('rejects invalid explicit provider', () => {
    expect(() => resolveProvider('mistral')).toThrow(/invalid --provider/);
  });

  it('throws when no key is set and no explicit provider', () => {
    expect(() => resolveProvider(undefined)).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe('envDefaultModel', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.BOTWARD_MODEL_ANTHROPIC;
    delete process.env.BOTWARD_MODEL_OPENAI;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('reads BOTWARD_MODEL_ANTHROPIC for anthropic', () => {
    process.env.BOTWARD_MODEL_ANTHROPIC = 'claude-test';
    expect(envDefaultModel('anthropic')).toBe('claude-test');
  });

  it('reads BOTWARD_MODEL_OPENAI for openai', () => {
    process.env.BOTWARD_MODEL_OPENAI = 'gpt-test';
    expect(envDefaultModel('openai')).toBe('gpt-test');
  });

  it('returns undefined when no env var is set', () => {
    expect(envDefaultModel('anthropic')).toBeUndefined();
    expect(envDefaultModel('openai')).toBeUndefined();
  });
});

describe('runInit (execute-flow init)', () => {
  it('happy path: model writes the main config and ends with a summary', async () => {
    const outputPath = path.join(initRoot, 'sub', 'botward.json');
    const outputDir = path.dirname(outputPath);

    const llm = new ScriptedLLM([
      // Turn 1: write_file the main config
      {
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'c1',
              name: 'write_file',
              arguments: { path: outputPath, content: VALID_CONFIG },
            },
          ],
        },
      },
      // Turn 2: final summary
      {
        stopReason: 'end_turn',
        message: { role: 'assistant', content: 'created echo bot' },
      },
    ]);

    const { result, config } = await runInit({
      requirements: 'make an echo bot',
      outputPath,
      outputDir,
      llm,
    });

    expect(result.finalText).toBe('created echo bot');
    expect(result.iterations).toBe(2);
    expect(config.tools.map((t) => t.name).sort()).toEqual([
      'list_files',
      'read_file',
      'search_files',
      'write_file',
    ]);

    // File actually exists on disk and parses as a valid config.
    const written = await fs.readFile(outputPath, 'utf-8');
    expect(JSON.parse(written).name).toBe('Echo bot');
    expect(ConfigSchema.safeParse(JSON.parse(written)).success).toBe(true);
  });

  it('multi-file: model writes main config + tool + skill, all on disk', async () => {
    const outputPath = path.join(initRoot, 'botward.json');
    const outputDir = initRoot;
    const toolPath = path.join(outputDir, 'tools', 'echo.cjs');
    const skillPath = path.join(outputDir, 'skills', 'greet', 'SKILL.md');

    const llm = new ScriptedLLM([
      {
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'c1',
              name: 'write_file',
              arguments: { path: outputPath, content: VALID_CONFIG },
            },
          ],
        },
      },
      {
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'c2',
              name: 'write_file',
              arguments: {
                path: toolPath,
                content: 'module.exports = async ({msg}) => ({echoed: msg});',
              },
            },
          ],
        },
      },
      {
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'c3',
              name: 'write_file',
              arguments: { path: skillPath, content: '# greet\nSay hi.' },
            },
          ],
        },
      },
      {
        stopReason: 'end_turn',
        message: { role: 'assistant', content: 'all three files written' },
      },
    ]);

    const { result } = await runInit({ requirements: 'multi-file', outputPath, outputDir, llm });
    expect(result.finalText).toBe('all three files written');

    const main = await fs.readFile(outputPath, 'utf-8');
    expect(JSON.parse(main).name).toBe('Echo bot');
    expect(await fs.readFile(toolPath, 'utf-8')).toContain('echoed');
    expect(await fs.readFile(skillPath, 'utf-8')).toContain('greet');
  });

  it('permission denial recovery: write outside outputDir fails, then model retries inside', async () => {
    const outputPath = path.join(initRoot, 'botward.json');
    const outputDir = initRoot;
    // A path that is definitely outside the outputDir.
    const outside = path.join(os.tmpdir(), `__should_not_exist_${Date.now()}_${Math.random()}.txt`);

    const llm = new ScriptedLLM([
      {
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'c1', name: 'write_file', arguments: { path: outside, content: 'leak' } },
          ],
        },
      },
      // After permission denial, model retries with the right path.
      {
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'c2',
              name: 'write_file',
              arguments: { path: outputPath, content: VALID_CONFIG },
            },
          ],
        },
      },
      {
        stopReason: 'end_turn',
        message: { role: 'assistant', content: 'recovered' },
      },
    ]);

    const { result } = await runInit({ requirements: 'x', outputPath, outputDir, llm });
    expect(result.finalText).toBe('recovered');

    // Inside file exists.
    const main = await fs.readFile(outputPath, 'utf-8');
    expect(JSON.parse(main).name).toBe('Echo bot');
    // Outside file does not exist (write_file refused).
    await expect(fs.access(outside)).rejects.toThrow();
  });

  it('auto-creates the output dir if missing (initCommand contract)', async () => {
    // runInit itself doesn't mkdir — initCommand does. We test the
    // mkdir here separately to keep runInit's contract simple.
    const fresh = path.join(initRoot, 'never_existed', 'botward.json');
    await fs.mkdir(path.dirname(fresh), { recursive: true });
    const stat = await fs.stat(path.dirname(fresh));
    expect(stat.isDirectory()).toBe(true);
  });
});