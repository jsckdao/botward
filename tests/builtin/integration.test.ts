import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { loadConfig } from '../../src/config/loader.js';
import { loadTools } from '../../src/tools/loader.js';
import { runAgent } from '../../src/agent/loop.js';
import { composeSystemPrompt } from '../../src/agent/prompt.js';
import type { LLMClient, ChatRequest, ChatResponse } from '../../src/llm/types.js';

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

describe('integration: builtin + user tools in same config', () => {
  it('config with read_file + user tool loads and runs both via the agent loop', async () => {
    const tmp = path.join(fixturesDir, '__integration.json');
    const file = path.join(fixturesDir, '__integration_sample.txt');
    await fs.writeFile(file, 'integration payload');

    await fs.writeFile(
      tmp,
      JSON.stringify({
        name: 'IntegrationTest',
        provider: 'anthropic',
        maxIterations: 4,
        tools: [
          {
            name: 'read_file',
            description: 'Read a text file',
            permission: path.join(fixturesDir, '__integration_sample.txt'),
          },
          {
            name: 'echo_user',
            description: 'Echo the input',
            inputSchema: {
              type: 'object',
              properties: { msg: { type: 'string' } },
              required: ['msg'],
            },
            code: 'module.exports = async ({ msg }) => ({ echoed: msg });',
          },
        ],
      }),
    );

    try {
      const { config, configDir } = await loadConfig(tmp);
      const tools = await loadTools(config.tools, configDir);
      const toolNames = tools.map((t) => t.name).sort();
      expect(toolNames).toEqual(['echo_user', 'read_file']);

      const llm = new ScriptedLLM([
        // First turn: call read_file
        {
          stopReason: 'tool_use',
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'c1', name: 'read_file', arguments: { path: file } }],
          },
        },
        // Second turn: call user echo
        {
          stopReason: 'tool_use',
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'c2', name: 'echo_user', arguments: { msg: 'hi' } }],
          },
        },
        // Final turn
        {
          stopReason: 'end_turn',
          message: { role: 'assistant', content: 'all good' },
        },
      ]);

      const system = composeSystemPrompt(config, [], toolNames);
      const result = await runAgent('do the thing', { llm, tools, config, system });
      expect(result.finalText).toBe('all good');
      expect(result.iterations).toBe(3);
    } finally {
      await fs.unlink(tmp).catch(() => {});
      await fs.unlink(file).catch(() => {});
    }
  });

  it('builtin tool denies when permission is missing, even via agent loop', async () => {
    const tmp = path.join(fixturesDir, '__integration2.json');
    await fs.writeFile(
      tmp,
      JSON.stringify({
        name: 'IntegrationNoPerm',
        maxIterations: 3,
        tools: [
          {
            name: 'read_file',
            description: 'Read file (no permission!)',
          },
        ],
      }),
    );
    try {
      const { config, configDir } = await loadConfig(tmp);
      const tools = await loadTools(config.tools, configDir);
      const llm = new ScriptedLLM([
        {
          stopReason: 'tool_use',
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'c1', name: 'read_file', arguments: { path: '/etc/passwd' } }],
          },
        },
        {
          stopReason: 'end_turn',
          message: { role: 'assistant', content: 'recovered from denial' },
        },
      ]);
      const system = '';
      const result = await runAgent('try', { llm, tools, config, system });
      expect(result.finalText).toBe('recovered from denial');
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
  });
});