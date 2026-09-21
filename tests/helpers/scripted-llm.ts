import type { ChatRequest, ChatResponse, LLMClient } from '../../src/llm/types.js';

/**
 * LLMClient that walks through a queue of scripted responses, one per call.
 * Throws if exhausted. Used by tests to drive `runAgent` without hitting
 * the network.
 *
 * Each `chat()` invocation is also recorded in `requests` so tests can
 * inspect what was sent on each call. For example, tests that exercise
 * compression can verify that a call with `tools: []` was made for the
 * summary step and that the next call had a shorter `messages` array.
 */
export class ScriptedLLM implements LLMClient {
  responses: ChatResponse[];
  calls = 0;
  requests: ChatRequest[] = [];
  constructor(responses: ChatResponse[]) {
    this.responses = responses;
  }
  async chat(req: ChatRequest): Promise<ChatResponse> {
    // Snapshot the messages array so test assertions see what was sent on
    // THIS call, not the live array that the loop keeps mutating. The
    // individual message objects are still shared references (we don't deep
    // clone), but the array shape at the time of the call is preserved.
    this.requests.push({ ...req, messages: req.messages.slice() });
    const r = this.responses[this.calls++];
    if (!r) throw new Error(`ScriptedLLM: no response for call ${this.calls}`);
    return r;
  }
}
