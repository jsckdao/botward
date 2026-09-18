import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { runAgent } from '../src/agent/loop.js';
import { composeSystemPrompt } from '../src/agent/prompt.js';
import { loadConfig } from '../src/config/loader.js';
import { loadTools } from '../src/tools/loader.js';
import type { LLMClient, ChatRequest, ChatResponse } from '../src/llm/types.js';

class ScriptedLLM implements LLMClient {
  responses: ChatResponse[];
  calls = 0;
  constructor(responses: ChatResponse[]) {
    this.responses = responses;
  }
  async chat(_req: ChatRequest): Promise<ChatResponse> {
    const r = this.responses[this.calls++];
    if (!r) throw new Error(`ScriptedLLM: no response for call ${this.calls}`);
    return r;
  }
}

const fixturesDir = path.resolve('tests/fixtures');

describe('runAgent', () => {
  it('returns immediately when the LLM produces no tool calls', async () => {
    const llm = new ScriptedLLM([
      {
        stopReason: 'end_turn',
        message: { role: 'assistant', content: 'hi back' },
      },
    ]);

    const { config, configDir } = await loadConfig(path.join(fixturesDir, 'basic.json'));
    const tools = await loadTools(config.tools, configDir);
    const system = composeSystemPrompt(config, [], tools.map((t) => t.name));

    const result = await runAgent('hello', { llm, tools, config, system });
    expect(result.finalText).toBe('hi back');
    expect(result.iterations).toBe(1);
  });

  it('loops tool call -> tool result -> final', async () => {
    const llm = new ScriptedLLM([
      // 1st call: ask to echo
      {
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'echo', arguments: { msg: 'hi' } }],
        },
      },
      // 2nd call: final text
      {
        stopReason: 'end_turn',
        message: { role: 'assistant', content: 'done' },
      },
    ]);

    const { config, configDir } = await loadConfig(path.join(fixturesDir, 'basic.json'));
    const tools = await loadTools(config.tools, configDir);
    const system = composeSystemPrompt(config, [], tools.map((t) => t.name));

    const result = await runAgent('go', { llm, tools, config, system });
    expect(result.iterations).toBe(2);
    expect(result.finalText).toBe('done');
    expect(llm.calls).toBe(2);
  });

  it('feeds tool errors back as isError without crashing', async () => {
    const llm = new ScriptedLLM([
      {
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'doesNotExist', arguments: {} }],
        },
      },
      {
        stopReason: 'end_turn',
        message: { role: 'assistant', content: 'recovered' },
      },
    ]);

    const { config, configDir } = await loadConfig(path.join(fixturesDir, 'basic.json'));
    const tools = await loadTools(config.tools, configDir);
    const system = composeSystemPrompt(config, [], tools.map((t) => t.name));

    const result = await runAgent('go', { llm, tools, config, system });
    expect(result.finalText).toBe('recovered');
  });

  it('enforces tool timeoutMs and recovers on next turn', async () => {
    const fs = await import('node:fs/promises');
    const tmp = path.join(fixturesDir, '__timeout.json');
    await fs.writeFile(tmp, JSON.stringify({
      name: 'X',
      tools: [{
        name: 'slow', description: 'sleeps forever',
        // 50ms timeout so the test is fast.
        timeoutMs: 50,
        code: 'module.exports = async () => new Promise(() => {});',
        inputSchema: { type: 'object' },
      }],
    }));
    try {
      const { config, configDir } = await loadConfig(tmp);
      const tools = await loadTools(config.tools, configDir);
      const llm = new ScriptedLLM([
        {
          stopReason: 'tool_use',
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'c1', name: 'slow', arguments: {} }],
          },
        },
        {
          stopReason: 'end_turn',
          message: { role: 'assistant', content: 'recovered after timeout' },
        },
      ]);
      const result = await runAgent('x', { llm, tools, config, system: '' });
      expect(result.finalText).toBe('recovered after timeout');
    } finally {
      await fs.unlink(tmp);
    }
  });

  it('throws when exceeding maxIterations', async () => {
    const llm: LLMClient = {
      chat: vi.fn(async () => ({
        stopReason: 'tool_use' as const,
        message: {
          role: 'assistant' as const,
          content: '',
          toolCalls: [{ id: 'c1', name: 'echo', arguments: { msg: 'loop' } }],
        },
      })),
    };

    const fs = await import('node:fs/promises');
    const tmp = path.join(fixturesDir, '__maxiter.json');
    await fs.writeFile(tmp, JSON.stringify({
      name: 'X',
      maxIterations: 3,
      tools: [{
        name: 'echo', description: 'd',
        code: 'module.exports = async ({msg}) => ({ok:true});',
        inputSchema: { type: 'object' },
      }],
    }));
    try {
      const { config, configDir } = await loadConfig(tmp);
      const tools = await loadTools(config.tools, configDir);
      const system = '';
      await expect(
        runAgent('loop', { llm, tools, config, system }),
      ).rejects.toThrow(/exceeded maxIterations/);
    } finally {
      await fs.unlink(tmp);
    }
  });
});