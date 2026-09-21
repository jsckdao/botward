import { describe, expect, it } from 'vitest';
import type { LLMClient, UnifiedMessage, ChatRequest, ChatResponse } from '../src/llm/types.js';
import {
  KEEP_RECENT_TURNS,
  compressMessages,
  shouldCompress,
} from '../src/agent/compression.js';
import { parseContextLength } from '../src/config/units.js';

// ---- parseContextLength ----------------------------------------------------

describe('parseContextLength', () => {
  it('parses raw integers', () => {
    expect(parseContextLength('262144')).toBe(262144);
    expect(parseContextLength('1')).toBe(1);
  });

  it('parses k suffix (case insensitive)', () => {
    expect(parseContextLength('256k')).toBe(256_000);
    expect(parseContextLength('256K')).toBe(256_000);
  });

  it('parses m suffix (case insensitive)', () => {
    expect(parseContextLength('1m')).toBe(1_000_000);
    expect(parseContextLength('2M')).toBe(2_000_000);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseContextLength('  256K  ')).toBe(256_000);
    expect(parseContextLength('\t1m\n')).toBe(1_000_000);
  });

  it('parses decimals', () => {
    expect(parseContextLength('1.5m')).toBe(1_500_000);
    expect(parseContextLength('0.5k')).toBe(500);
  });

  it('rounds to nearest integer', () => {
    expect(parseContextLength('1.234k')).toBe(1234);
  });

  it('returns null for malformed input', () => {
    expect(parseContextLength('256X')).toBeNull();
    expect(parseContextLength('abc')).toBeNull();
    expect(parseContextLength('')).toBeNull();
    expect(parseContextLength('-1')).toBeNull();
    expect(parseContextLength('256k extra')).toBeNull();
    expect(parseContextLength('k')).toBeNull();
  });

  it('returns null for non-positive results', () => {
    expect(parseContextLength('0')).toBeNull();
  });
});

// ---- shouldCompress --------------------------------------------------------

describe('shouldCompress', () => {
  const base = { enabled: true, maxContextLength: 262_144, ratio: 0.9 };

  it('returns false when disabled', () => {
    expect(shouldCompress({ ...base, enabled: false }, 999_999)).toEqual({
      shouldCompress: false,
      threshold: 235_929.6,
    });
  });

  it('returns false when lastInputTokens is undefined (first iteration)', () => {
    expect(shouldCompress(base, undefined)).toEqual({
      shouldCompress: false,
      threshold: 235_929.6,
    });
  });

  it('returns false below the threshold', () => {
    expect(shouldCompress(base, 100_000).shouldCompress).toBe(false);
  });

  it('returns true at or above the threshold', () => {
    expect(shouldCompress(base, 235_930).shouldCompress).toBe(true);
    expect(shouldCompress(base, 262_144).shouldCompress).toBe(true);
  });

  it('exposes the computed threshold', () => {
    expect(shouldCompress({ ...base, maxContextLength: 1000, ratio: 0.5 }, 100).threshold).toBe(500);
  });
});

// ---- compressMessages ------------------------------------------------------

/** Build an alternating assistant tool_use / user tool_result history. */
function buildHistory(turns: number): UnifiedMessage[] {
  const out: UnifiedMessage[] = [{ role: 'user', content: 'do the thing' }];
  for (let i = 1; i <= turns; i++) {
    out.push({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: `c${i}`, name: 'echo', arguments: { i } }],
    });
    out.push({
      role: 'user',
      content: '',
      toolResults: [{ toolCallId: `c${i}`, content: `result ${i}` }],
    });
  }
  return out;
}

class StubLLM implements LLMClient {
  responses: ChatResponse[];
  capturedRequests: ChatRequest[] = [];
  throwErr: Error | null = null;
  constructor(responses: ChatResponse[]) {
    this.responses = responses;
  }
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.capturedRequests.push(req);
    if (this.throwErr) throw this.throwErr;
    const r = this.responses.shift();
    if (!r) throw new Error('StubLLM: no response queued');
    return r;
  }
}

function summaryResp(text: string): ChatResponse {
  return {
    message: { role: 'assistant', content: text },
    stopReason: 'end_turn',
  };
}

describe('compressMessages', () => {
  it('is a no-op when history has only the user task', async () => {
    const messages: UnifiedMessage[] = [{ role: 'user', content: 'task' }];
    const llm = new StubLLM([]);
    const result = await compressMessages(messages, KEEP_RECENT_TURNS, llm, undefined);
    expect(result).toEqual(messages);
    expect(llm.capturedRequests).toHaveLength(0);
  });

  it('is a no-op when history is at the cutoff boundary (no older messages)', async () => {
    // 1 task + 2 * KEEP_RECENT_TURNS = 7 messages. Exactly at boundary.
    const messages = buildHistory(KEEP_RECENT_TURNS);
    const llm = new StubLLM([]);
    const result = await compressMessages(messages, KEEP_RECENT_TURNS, llm, undefined);
    // No older messages to summarize; result equals input length but is a new array.
    expect(result).toHaveLength(messages.length);
    expect(llm.capturedRequests).toHaveLength(0);
  });

  it('replaces older turns with a single summary and keeps recent verbatim', async () => {
    // 5 turns -> 11 messages. cutoff = 11 - 6 = 5. older = messages[1..5].
    const messages = buildHistory(5);
    const llm = new StubLLM([summaryResp('condensed prose summary')]);

    const result = await compressMessages(messages, 3, llm, undefined);

    expect(result).toHaveLength(8); // 1 task + 1 summary + 6 recent
    // messages[0] is the original user task — REFERENCE EQUAL (not a copy).
    expect(result[0]).toBe(messages[0]);
    // summary message
    expect(result[1].role).toBe('user');
    expect(result[1].content).toMatch(/^\[CONTEXT SUMMARY/);
    expect(result[1].content).toContain('condensed prose summary');
    // recent block verbatim
    expect(result[2]).toBe(messages[5]);
    expect(result[3]).toBe(messages[6]);
    expect(result[4]).toBe(messages[7]);
    expect(result[5]).toBe(messages[8]);
    expect(result[6]).toBe(messages[9]);
    expect(result[7]).toBe(messages[10]);
  });

  it('sends summary request with tools=[] and the older messages', async () => {
    const messages = buildHistory(4); // 9 messages, cutoff = 3
    const llm = new StubLLM([summaryResp('summary')]);
    await compressMessages(messages, 3, llm, 'claude-sonnet-4-5');

    expect(llm.capturedRequests).toHaveLength(1);
    const req = llm.capturedRequests[0];
    expect(req.tools).toEqual([]);
    expect(req.messages).toEqual(messages.slice(1, 3));
    expect(req.system).toMatch(/context-compaction/);
    expect(req.model).toBe('claude-sonnet-4-5');
  });

  it('warns and returns input unchanged when summary returns empty text', async () => {
    const messages = buildHistory(4);
    const llm = new StubLLM([summaryResp('')]);
    const result = await compressMessages(messages, 3, llm, undefined);
    // Same length as input — no compression happened.
    expect(result).toHaveLength(messages.length);
    expect(result[0]).toBe(messages[0]);
    // No message should carry the CONTEXT SUMMARY marker.
    const anySummary = result.some((m) => typeof m.content === 'string' && m.content.includes('CONTEXT SUMMARY'));
    expect(anySummary).toBe(false);
  });

  it('warns and returns input unchanged when LLM throws', async () => {
    const messages = buildHistory(4);
    const llm = new StubLLM([]);
    llm.throwErr = new Error('rate limited');
    const result = await compressMessages(messages, 3, llm, undefined);
    expect(result).toHaveLength(messages.length);
    expect(result[0]).toBe(messages[0]);
    const anySummary = result.some((m) => typeof m.content === 'string' && m.content.includes('CONTEXT SUMMARY'));
    expect(anySummary).toBe(false);
  });

  it('never mutates the input array', async () => {
    const messages = buildHistory(5);
    const snapshot = JSON.parse(JSON.stringify(messages));
    const llm = new StubLLM([summaryResp('summary')]);
    await compressMessages(messages, 3, llm, undefined);
    expect(messages).toEqual(snapshot);
  });
});
