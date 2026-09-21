import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Botward } from '../src/api.js';
import { BotwardError } from '../src/utils/errors.js';
import type { Config } from '../src/config/schema.js';
import type { LLMClient } from '../src/llm/types.js';
import type { ClientOptions } from '../src/llm/factory.js';
import { ScriptedLLM } from './helpers/scripted-llm.js';

/** LLM factory that hands out a single scripted LLM for every call. */
function scriptedFactory(llm: LLMClient) {
  return (_cfg: Config, _opts: ClientOptions) => llm;
}

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
const apiRoot = path.join(fixturesRoot, '__api_tmp');

beforeEach(async () => {
  await fs.rm(apiRoot, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(apiRoot, { recursive: true, force: true });
});

describe('Botward constructor', () => {
  it('rejects empty providers array', () => {
    expect(() => new Botward({ providers: [] })).toThrow(BotwardError);
    expect(() => new Botward({ providers: [] })).toThrow(/at least one/);
  });

  it('rejects unknown provider type', () => {
    expect(
      () =>
        new Botward({
          providers: [{ type: 'mistral' as unknown as 'anthropic' }],
        }),
    ).toThrow(/must be "anthropic" or "openai"/);
  });

  it('rejects duplicate provider type', () => {
    expect(
      () =>
        new Botward({
          providers: [
            { type: 'anthropic', apiKey: 'a' },
            { type: 'anthropic', apiKey: 'b' },
          ],
        }),
    ).toThrow(/duplicates type/);
  });

  it('accepts a single well-formed provider', () => {
    expect(
      () =>
        new Botward({
          providers: [{ type: 'anthropic', apiKey: 'sk-test' }],
        }),
    ).not.toThrow();
  });
});

describe('Botward.execute', () => {
  it('returns AgentRunResult and never writes to stdout', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const llm = new ScriptedLLM([
        {
          stopReason: 'end_turn',
          message: { role: 'assistant', content: 'final answer from library' },
        },
      ]);
      const botward = new Botward({
        providers: [{ type: 'anthropic', apiKey: 'sk-test' }],
        llmFactory: scriptedFactory(llm),
      });
      const result = await botward.execute('say hi', {
        config: path.join(fixturesRoot, 'basic.json'),
      });
      expect(result.finalText).toBe('final answer from library');
      expect(result.iterations).toBe(1);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('passes provider entry apiKey/baseUrl/model into the factory', async () => {
    const calls: Array<{ provider: string; opts: ClientOptions }> = [];
    const llm = new ScriptedLLM([
      {
        stopReason: 'end_turn',
        message: { role: 'assistant', content: 'ok' },
      },
    ]);
    const botward = new Botward({
      providers: [
        {
          type: 'anthropic',
          apiKey: 'sk-test',
          baseUrl: 'https://example.test/v1',
          model: 'claude-x',
        },
      ],
      llmFactory: (cfg, opts) => {
        calls.push({ provider: cfg.provider, opts });
        return llm;
      },
    });
    await botward.execute('x', {
      config: path.join(fixturesRoot, 'basic.json'),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.provider).toBe('anthropic');
    expect(calls[0]!.opts.apiKey).toBe('sk-test');
    expect(calls[0]!.opts.baseURL).toBe('https://example.test/v1');
    expect(calls[0]!.opts.model).toBe('claude-x');
  });

  it('throws BotwardError for a missing config file', async () => {
    const llm = new ScriptedLLM([]);
    const botward = new Botward({
      providers: [{ type: 'anthropic', apiKey: 'sk-test' }],
      llmFactory: scriptedFactory(llm),
    });
    await expect(
      botward.execute('x', { config: '/no/such/file/botward.json' }),
    ).rejects.toBeInstanceOf(BotwardError);
  });

  it('feeds tool results back to the LLM via the agent loop', async () => {
    const llm = new ScriptedLLM([
      {
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'echo', arguments: { msg: 'hi' } }],
        },
      },
      {
        stopReason: 'end_turn',
        message: { role: 'assistant', content: 'tool returned' },
      },
    ]);
    const botward = new Botward({
      providers: [{ type: 'anthropic', apiKey: 'sk-test' }],
      llmFactory: scriptedFactory(llm),
    });
    const result = await botward.execute('go', {
      config: path.join(fixturesRoot, 'basic.json'),
    });
    expect(result.finalText).toBe('tool returned');
    expect(llm.calls).toBe(2);
  });
});

describe('Botward.init', () => {
  it('happy path: scripted LLM writes main config, library returns InitResult', async () => {
    const outputPath = path.join(apiRoot, 'botward.json');
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
        stopReason: 'end_turn',
        message: { role: 'assistant', content: 'done' },
      },
    ]);
    const botward = new Botward({
      providers: [{ type: 'anthropic', apiKey: 'sk-test' }],
      llmFactory: scriptedFactory(llm),
    });
    const out = await botward.init('echo bot', { output: outputPath });

    expect(out.outputPath).toBe(outputPath);
    expect(out.outputDir).toBe(path.dirname(outputPath));
    expect(out.provider).toBe('anthropic');
    expect(out.model).toBeUndefined();
    expect(out.result.finalText).toBe('done');
    expect(out.result.iterations).toBe(2);

    const written = await fs.readFile(outputPath, 'utf-8');
    expect(JSON.parse(written).name).toBe('Echo bot');
  });

  it('does not write to stdout', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const outputPath = path.join(apiRoot, 'botward.json');
      const llm = new ScriptedLLM([
        {
          stopReason: 'tool_use',
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'c1', name: 'write_file', arguments: { path: outputPath, content: VALID_CONFIG } },
            ],
          },
        },
        { stopReason: 'end_turn', message: { role: 'assistant', content: 'ok' } },
      ]);
      const botward = new Botward({
        providers: [{ type: 'anthropic', apiKey: 'sk-test' }],
        llmFactory: scriptedFactory(llm),
      });
      await botward.init('x', { output: outputPath });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('auto-creates deeply nested outputDir', async () => {
    const outputPath = path.join(apiRoot, 'deep', 'nested', 'project', 'botward.json');
    const llm = new ScriptedLLM([
      {
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'c1', name: 'write_file', arguments: { path: outputPath, content: VALID_CONFIG } },
          ],
        },
      },
      { stopReason: 'end_turn', message: { role: 'assistant', content: 'ok' } },
    ]);
    const botward = new Botward({
      providers: [{ type: 'anthropic', apiKey: 'sk-test' }],
      llmFactory: scriptedFactory(llm),
    });
    await botward.init('x', { output: outputPath });
    const stat = await fs.stat(path.dirname(outputPath));
    expect(stat.isDirectory()).toBe(true);
  });

  it('throws BotwardError if model never creates the main config', async () => {
    const outputPath = path.join(apiRoot, 'botward.json');
    const llm = new ScriptedLLM([
      { stopReason: 'end_turn', message: { role: 'assistant', content: 'I refuse' } },
    ]);
    const botward = new Botward({
      providers: [{ type: 'anthropic', apiKey: 'sk-test' }],
      llmFactory: scriptedFactory(llm),
    });
    await expect(botward.init('x', { output: outputPath })).rejects.toBeInstanceOf(
      BotwardError,
    );
  });

  it('rejects empty requirements', async () => {
    const botward = new Botward({
      providers: [{ type: 'anthropic', apiKey: 'sk-test' }],
      llmFactory: scriptedFactory(new ScriptedLLM([])),
    });
    await expect(botward.init('   ', { output: path.join(apiRoot, 'x.json') })).rejects.toThrow(
      /non-empty/,
    );
  });

  it('explicit provider override: must match a constructor entry', async () => {
    const botward = new Botward({
      providers: [{ type: 'anthropic', apiKey: 'sk-test' }],
      llmFactory: scriptedFactory(new ScriptedLLM([])),
    });
    await expect(
      botward.init('x', {
        output: path.join(apiRoot, 'o.json'),
        provider: 'openai',
      }),
    ).rejects.toThrow(/no matching entry/);
  });

  it('explicit provider + model flows into buildInitConfig', async () => {
    const spy = vi.spyOn(await import('../src/cli/commands/init.js'), 'buildInitConfig');
    const outputPath = path.join(apiRoot, 'botward.json');
    const llm = new ScriptedLLM([
      {
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'write_file', arguments: { path: outputPath, content: VALID_CONFIG } }],
        },
      },
      { stopReason: 'end_turn', message: { role: 'assistant', content: 'ok' } },
    ]);
    const botward = new Botward({
      providers: [{ type: 'anthropic', apiKey: 'sk-test' }],
      llmFactory: scriptedFactory(llm),
    });
    await botward.init('x', {
      output: outputPath,
      provider: 'anthropic',
      model: 'claude-test-7',
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        outputPath,
        outputDir: path.dirname(outputPath),
        provider: 'anthropic',
        model: 'claude-test-7',
      }),
    );
    spy.mockRestore();
  });

  it('picks the first entry with a non-empty apiKey when no explicit provider', async () => {
    const spy = vi.spyOn(await import('../src/cli/commands/init.js'), 'buildInitConfig');
    const outputPath = path.join(apiRoot, 'botward.json');
    const llm = new ScriptedLLM([
      {
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'write_file', arguments: { path: outputPath, content: VALID_CONFIG } }],
        },
      },
      { stopReason: 'end_turn', message: { role: 'assistant', content: 'ok' } },
    ]);
    const botward = new Botward({
      providers: [
        { type: 'openai', apiKey: 'sk-openai' },
        { type: 'anthropic', apiKey: 'sk-anthropic' },
      ],
      llmFactory: scriptedFactory(llm),
    });
    await botward.init('x', { output: outputPath });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ provider: 'openai' }));
    spy.mockRestore();
  });

  it('falls back to env when providers[] have no apiKey', async () => {
    const spy = vi.spyOn(await import('../src/cli/commands/init.js'), 'buildInitConfig');
    const originalEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'env-anthropic';
    try {
      const outputPath = path.join(apiRoot, 'botward.json');
      const llm = new ScriptedLLM([
        {
          stopReason: 'tool_use',
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'c1', name: 'write_file', arguments: { path: outputPath, content: VALID_CONFIG } }],
          },
        },
        { stopReason: 'end_turn', message: { role: 'assistant', content: 'ok' } },
      ]);
      const botward = new Botward({
        providers: [{ type: 'anthropic' }], // no apiKey
        llmFactory: scriptedFactory(llm),
      });
      await botward.init('x', { output: outputPath });
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ provider: 'anthropic' }));
    } finally {
      if (originalEnv === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = originalEnv;
      spy.mockRestore();
    }
  });

  it('throws when nothing usable: no apiKey in providers and no env key', async () => {
    const originalAnthropic = process.env.ANTHROPIC_API_KEY;
    const originalOpenai = process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const botward = new Botward({
        providers: [{ type: 'anthropic' }],
        llmFactory: scriptedFactory(new ScriptedLLM([])),
      });
      await expect(
        botward.init('x', { output: path.join(apiRoot, 'o.json') }),
      ).rejects.toBeInstanceOf(BotwardError);
    } finally {
      if (originalAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = originalAnthropic;
      if (originalOpenai !== undefined) process.env.OPENAI_API_KEY = originalOpenai;
    }
  });
});