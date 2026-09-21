import type { ChatRequest, ChatResponse, LLMClient } from '../../src/llm/types.js';

/**
 * LLMClient that walks through a queue of scripted responses, one per call.
 * Throws if exhausted. Used by tests to drive `runAgent` without hitting
 * the network.
 */
export class ScriptedLLM implements LLMClient {
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