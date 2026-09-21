import type { ChatRequest, ChatResponse, LLMClient, UnifiedMessage } from '../llm/types.js';
import { logger } from '../utils/logger.js';

/**
 * How many most-recent complete turns (1 turn = assistant tool_use + user
 * tool_result pair, counted as 2 messages) to keep verbatim when compressing.
 * Older turns are condensed into a single summary message.
 *
 * A larger value keeps more recent context but reduces compression headroom.
 * A smaller value compresses more aggressively but may lose recent nuance.
 */
export const KEEP_RECENT_TURNS = 3;

export interface CompressionConfig {
  enabled: boolean;
  maxContextLength: number;
  ratio: number;
}

export interface CompressionDecision {
  shouldCompress: boolean;
  threshold: number;
}

/**
 * Decide whether the next iteration should compress before calling the LLM.
 * Uses the previous iteration's `inputTokens` — token counts are only
 * available AFTER an `llm.chat` returns, so the first iteration always skips.
 */
export function shouldCompress(
  cfg: CompressionConfig,
  lastInputTokens: number | undefined,
): CompressionDecision {
  const threshold = cfg.maxContextLength * cfg.ratio;
  if (!cfg.enabled) return { shouldCompress: false, threshold };
  if (lastInputTokens === undefined) return { shouldCompress: false, threshold };
  return {
    shouldCompress: lastInputTokens >= threshold,
    threshold,
  };
}

/**
 * Build a summary request that asks the LLM to condense the older history.
 * Reuses `LLMClient.chat` with `tools: []` so we don't need a new method on
 * the adapter.
 */
function buildSummaryRequest(
  olderMessages: UnifiedMessage[],
  model: string | undefined,
): ChatRequest {
  const summarySystem = [
    'You are a context-compaction assistant.',
    'The user will send you older conversation history (alternating assistant',
    'tool_use blocks and user tool_result blocks). Produce a concise prose',
    'summary capturing: (1) the user\'s original goal, (2) each tool that was',
    'called and its arguments, (3) the key facts discovered in each tool',
    'result, (4) any errors encountered and how they were resolved.',
    'Do NOT include raw tool output verbatim. Aim for under 1500 words.',
    'Return ONLY the summary text, no preamble, no labels.',
  ].join(' ');

  return {
    ...(model !== undefined ? { model } : {}),
    system: summarySystem,
    messages: olderMessages,
    tools: [],
    maxTokens: 2048,
    temperature: 0,
  };
}

/** Extract plain text from a ChatResponse (handles string and block-array content). */
function extractText(resp: ChatResponse): string {
  const c = resp.message.content;
  if (typeof c === 'string') return c.trim();
  return c.map((b) => b.text).join('').trim();
}

/**
 * Compress the older portion of `messages` into a single summary message.
 *
 * Layout:
 *   messages[0]                         — user task, ALWAYS preserved at index 0
 *   messages[1..K]                      — older turns, replaced by summary
 *   messages[K..K + 2*keepRecentTurns]  — recent turns, kept verbatim
 *
 * Returns a NEW array. Never mutates the input.
 *
 * Failure policy: if the summary call throws, errors out, or returns empty
 * text, log a warning and return a shallow copy of the input unchanged. The
 * caller can retry on the next iteration. This keeps transient LLM hiccups
 * from aborting long-running tasks; if the window is genuinely exceeded the
 * next LLM call will surface its own error.
 */
export async function compressMessages(
  messages: UnifiedMessage[],
  keepRecentTurns: number,
  llm: LLMClient,
  model: string | undefined,
): Promise<UnifiedMessage[]> {
  // Need: user task + at least one older message + the kept-recent block.
  const minLength = 1 + 2 * keepRecentTurns;
  if (messages.length <= minLength) {
    return messages.slice();
  }

  const cutoff = messages.length - 2 * keepRecentTurns;
  const olderMessages = messages.slice(1, cutoff);

  if (olderMessages.length === 0) {
    return messages.slice();
  }

  let summaryText: string;
  try {
    const resp = await llm.chat(buildSummaryRequest(olderMessages, model));
    summaryText = extractText(resp);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`context compression skipped: summary call failed: ${msg}`);
    return messages.slice();
  }

  if (summaryText.length === 0) {
    logger.warn('context compression skipped: summary returned empty text');
    return messages.slice();
  }

  const summaryMessage: UnifiedMessage = {
    role: 'user',
    content:
      '[CONTEXT SUMMARY — older history compressed; recent messages follow]\n\n' +
      summaryText,
  };

  // NOTE on cache_control: the Anthropic adapter re-derives cache_control on
  // every request (src/llm/anthropic.ts), attaching it to the last tool_result
  // block of the most recent user message. After compression, that block is
  // still the last item in the array (we kept the recent block verbatim), so
  // cache_control lands correctly on the next call. Inserting this summary
  // user message invalidates the prefix cache from this point — the next call
  // is one cache_write, and the call after that returns to cache_read.
  return [
    messages[0],            // user task — reference-equal, byte-identical
    summaryMessage,
    ...messages.slice(cutoff),
  ];
}
