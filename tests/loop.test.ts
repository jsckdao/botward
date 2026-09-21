import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { runAgent } from '../src/agent/loop.js';
import { composeSystemPrompt } from '../src/agent/prompt.js';
import { loadConfig } from '../src/config/loader.js';
import { loadTools } from '../src/tools/loader.js';
import type { LLMClient } from '../src/llm/types.js';
import { ScriptedLLM } from './helpers/scripted-llm.js';

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

  it('compresses older history when lastInputTokens crosses the threshold', async () => {
    // Default maxContextLength = 262_144, ratio = 0.9, threshold = 235_929.
    // Turn 4 reports inputTokens = 240_000 (> threshold), which forces a
    // summary call before turn 5.
    const llm = new ScriptedLLM([
      // 1st turn: ask to echo with low usage
      {
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'echo', arguments: { msg: 'a' } }],
        },
        usage: { inputTokens: 1000, outputTokens: 50 },
      },
      // 2nd turn
      {
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c2', name: 'echo', arguments: { msg: 'b' } }],
        },
        usage: { inputTokens: 1500, outputTokens: 50 },
      },
      // 3rd turn
      {
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c3', name: 'echo', arguments: { msg: 'c' } }],
        },
        usage: { inputTokens: 2000, outputTokens: 50 },
      },
      // 4th turn — high usage, will trigger compression before turn 5
      {
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c4', name: 'echo', arguments: { msg: 'd' } }],
        },
        usage: { inputTokens: 240_000, outputTokens: 50 },
      },
      // 5th turn: the SUMMARY response (consumed by compressMessages)
      {
        stopReason: 'end_turn',
        message: { role: 'assistant', content: 'condensed prose summary' },
      },
      // 6th turn: turn 5's main chat AFTER compression
      {
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c5', name: 'echo', arguments: { msg: 'e' } }],
        },
        usage: { inputTokens: 3000, outputTokens: 50 },
      },
      // 7th turn: final answer
      {
        stopReason: 'end_turn',
        message: { role: 'assistant', content: 'final' },
      },
    ]);

    const { config, configDir } = await loadConfig(path.join(fixturesDir, 'basic.json'));
    const tools = await loadTools(config.tools, configDir);
    const system = composeSystemPrompt(config, [], tools.map((t) => t.name));
    const task = 'walk the dog';

    const result = await runAgent(task, { llm, tools, config, system });

    expect(result.finalText).toBe('final');
    expect(llm.calls).toBe(7); // 5 main + 1 summary + 1 final = 7

    // Inspect what each call received.
    // requests[0..3] are main chats 0..3
    // requests[4] is the summary call
    // requests[5] is main chat 4 (after compression)
    // requests[6] is main chat 5 (final)
    const summaryReq = llm.requests[4];
    expect(summaryReq.tools).toEqual([]);
    expect(summaryReq.system).toMatch(/context-compaction/);

    const postCompressReq = llm.requests[5];
    // After compression, the summary message sits at index 1 and the kept
    // recent block follows.
    expect(postCompressReq.messages[0].content).toBe(task);
    expect(postCompressReq.messages[1].role).toBe('user');
    expect(postCompressReq.messages[1].content).toMatch(/^\[CONTEXT SUMMARY/);
    // Pre-compression had: task + 4 turns = 9 messages. After compression
    // (KEEP_RECENT_TURNS=3) we keep the last 3 turns verbatim:
    // task + summary + (turns 2..4) = 1 + 1 + 6 = 8 messages.
    expect(postCompressReq.messages.length).toBe(8);
  });

  it('does not compress when contextCompression is disabled', async () => {
    const llm = new ScriptedLLM([
      // Turn 0: tool use, low usage
      {
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'echo', arguments: { msg: 'a' } }],
        },
        usage: { inputTokens: 1000, outputTokens: 50 },
      },
      // Turn 1: tool use, HIGH usage — would normally trigger compression
      {
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c2', name: 'echo', arguments: { msg: 'b' } }],
        },
        usage: { inputTokens: 999_999, outputTokens: 50 },
      },
      // Turn 2: final
      {
        stopReason: 'end_turn',
        message: { role: 'assistant', content: 'done' },
      },
    ]);

    const fs = await import('node:fs/promises');
    const tmp = path.join(fixturesDir, '__nocompress.json');
    await fs.writeFile(tmp, JSON.stringify({
      name: 'X',
      contextCompression: false,
      tools: [{
        name: 'echo', description: 'd',
        code: 'module.exports = async ({msg}) => ({ok:true});',
        inputSchema: { type: 'object' },
      }],
    }));
    try {
      const { config, configDir } = await loadConfig(tmp);
      const tools = await loadTools(config.tools, configDir);
      const result = await runAgent('task', { llm, tools, config, system: '' });
      expect(result.finalText).toBe('done');
      expect(llm.calls).toBe(3); // 2 tool + 1 final; NO summary call
      // No request should have had tools: [] (summary signature).
      for (const req of llm.requests) {
        expect(req.tools.length).toBeGreaterThan(0);
      }
    } finally {
      await fs.unlink(tmp);
    }
  });

  it('keeps system and messages[0] byte-identical across all calls', async () => {
    const llm = new ScriptedLLM([
      // Run 5 turns, none crosses the threshold (just enumerate).
      ...Array.from({ length: 4 }, (_, i) => ({
        stopReason: 'tool_use' as const,
        message: {
          role: 'assistant' as const,
          content: '',
          toolCalls: [{ id: `c${i}`, name: 'echo', arguments: { msg: String(i) } }],
        },
        usage: { inputTokens: 1000 + i * 100, outputTokens: 50 },
      })),
      {
        stopReason: 'end_turn',
        message: { role: 'assistant', content: 'final' },
      },
    ]);

    const { config, configDir } = await loadConfig(path.join(fixturesDir, 'basic.json'));
    const tools = await loadTools(config.tools, configDir);
    const system = composeSystemPrompt(config, [], tools.map((t) => t.name));
    const task = 'preserve me';

    await runAgent(task, { llm, tools, config, system });

    // Every main-chat request (not summary requests, of which there are none
    // here because threshold was never crossed) must have:
    // - the same `system` string
    // - the same `messages[0].content` (the user task)
    const systems = new Set(llm.requests.map((r) => r.system));
    const firstMessages = new Set(llm.requests.map((r) => r.messages[0]?.content));
    expect(systems.size).toBe(1);
    expect(firstMessages.size).toBe(1);
    expect([...firstMessages][0]).toBe(task);
  });
});