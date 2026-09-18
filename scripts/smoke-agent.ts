import { runAgent } from '../src/agent/loop.js';
import { composeSystemPrompt } from '../src/agent/prompt.js';
import { loadConfig } from '../src/config/loader.js';
import { loadTools } from '../src/tools/loader.js';
import type { LLMClient, ChatRequest, ChatResponse } from '../src/llm/types.js';

class MockLLM implements LLMClient {
  calls = 0;
  async chat(_req: ChatRequest): Promise<ChatResponse> {
    this.calls++;
    if (this.calls === 1) {
      // First turn: ask to call echo tool
      return {
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'echo', arguments: { msg: 'hi from tool' } }],
        },
      };
    }
    // Second turn: final text
    return {
      stopReason: 'end_turn',
      message: { role: 'assistant', content: 'all done' },
    };
  }
}

const { config, configDir } = await loadConfig('tests/fixtures/basic.json');
const tools = await loadTools(config.tools, configDir);
const system = composeSystemPrompt(config, [], tools.map((t) => t.name));
const llm = new MockLLM();

const result = await runAgent('echo test', { llm, tools, config, system });
console.log('iterations:', result.iterations);
console.log('stopReason:', result.stopReason);
console.log('finalText:', JSON.stringify(result.finalText));
console.log('llm.calls:', llm.calls);