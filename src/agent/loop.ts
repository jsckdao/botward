import type { Config } from '../config/schema.js';
import type { LLMClient, ToolResult, UnifiedMessage } from '../llm/types.js';
import type { LoadedTool } from '../tools/sandbox.js';
import { logger } from '../utils/logger.js';
import { BotwardError } from '../utils/errors.js';
import {
  KEEP_RECENT_TURNS,
  compressMessages,
  shouldCompress,
} from './compression.js';

export interface AgentRunResult {
  /** Last assistant text. Empty string if the model never produced one. */
  finalText: string;
  iterations: number;
  stopReason: string;
}

export interface RunAgentDeps {
  llm: LLMClient;
  tools: LoadedTool[];
  config: Config;
  system: string;
}

/**
 * The single-task agent loop. No persistent history between invocations —
 * this is a one-shot per `botward execute` run.
 *
 * Loop:
 *   1. Send system + messages + tools to LLM.
 *   2. Push assistant message onto history.
 *   3. If stopReason is tool_use (or has tool_calls), run each tool, push
 *      tool_results as a user message, repeat.
 *   4. Otherwise return final text.
 */
export async function runAgent(
  task: string,
  deps: RunAgentDeps,
): Promise<AgentRunResult> {
  const { llm, tools, config, system } = deps;
  let messages: UnifiedMessage[] = [
    { role: 'user', content: task },
  ];

  const toolByName = new Map<string, LoadedTool>();
  for (const t of tools) toolByName.set(t.name, t);

  const toolSpecs = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));

  let finalText = '';
  let lastStopReason = 'end_turn';
  // Tracks input tokens from the previous turn so we can decide whether to
  // compress before the next llm.chat call. Undefined for the first iteration.
  let lastInputTokens: number | undefined;

  for (let iter = 0; iter < config.maxIterations; iter++) {
    // Pre-flight: compress older history if the previous response crossed the
    // configured threshold. The user task at messages[0] and the system prompt
    // are never touched.
    const decision = shouldCompress(
      {
        enabled: config.contextCompression,
        maxContextLength: config.maxContextLength,
        ratio: config.maxContextLengthRatio,
      },
      lastInputTokens,
    );
    if (decision.shouldCompress) {
      const before = messages.length;
      messages = await compressMessages(
        messages,
        KEEP_RECENT_TURNS,
        llm,
        config.model,
      );
      if (messages.length !== before) {
        logger.info(
          `context compressed: ${before} -> ${messages.length} msgs ` +
            `(last in_tokens=${lastInputTokens}, threshold=${Math.round(decision.threshold)})`,
        );
      }
    }

    const resp = await llm.chat({
      model: config.model,
      system,
      messages,
      tools: toolSpecs,
    });

    if (resp.usage) {
      const { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens } = resp.usage;
      lastInputTokens = inputTokens;
      const parts = [
        `in=${inputTokens}`,
        `out=${outputTokens}`,
      ];
      if (cacheCreationTokens) parts.push(`cache_write=${cacheCreationTokens}`);
      if (cacheReadTokens) parts.push(`cache_read=${cacheReadTokens}`);
      logger.info(`turn ${iter + 1} tokens: ${parts.join(' ')}`);
    } else {
      logger.info(`turn ${iter + 1}: (no usage reported)`);
    }

    messages.push(resp.message);
    lastStopReason = resp.stopReason;

    if (typeof resp.message.content === 'string') {
      finalText = resp.message.content;
    } else if (Array.isArray(resp.message.content)) {
      finalText = resp.message.content.map((b) => b.text).join('');
    }

    // Exit if the model did not request any tools.
    const toolCalls = resp.message.toolCalls;
    if (!toolCalls || toolCalls.length === 0) {
      return { finalText, iterations: iter + 1, stopReason: lastStopReason };
    }

    // Execute each requested tool; never let a tool crash the loop.
    const results: ToolResult[] = [];
    for (const call of toolCalls) {
      const tool = toolByName.get(call.name);
      if (!tool) {
        results.push({
          toolCallId: call.id,
          content: `tool not found: ${call.name}`,
          isError: true,
        });
        logger.warn(`LLM requested unknown tool "${call.name}"`);
        continue;
      }

      try {
        const output = await runWithTimeout(tool.run(call.arguments, tool.permissions), tool.timeoutMs);
        const serialized = safeStringify(output, tool.maxOutputBytes);
        logger.tool(tool.name, serialized);
        results.push({ toolCallId: call.id, content: serialized });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`tool ${tool.name} failed: ${msg}`);
        results.push({ toolCallId: call.id, content: msg, isError: true });
      }
    }

    messages.push({ role: 'user', content: '', toolResults: results });
  }

  throw new BotwardError(
    `agent exceeded maxIterations (${config.maxIterations}) without completing`,
  );
}

function safeStringify(value: unknown, maxBytes: number): string {
  let s: string;
  try {
    s = JSON.stringify(value, (_key, v) => v ?? null);
  } catch {
    s = String(value);
  }
  const bytes = Buffer.byteLength(s, 'utf-8');
  if (bytes <= maxBytes) return s;
  // Truncate to fit.
  const truncated = s.slice(0, Math.floor(maxBytes * 0.9));
  return `${truncated}\n...[truncated ${bytes - truncated.length} bytes]`;
}

class TimeoutError extends Error {
  override readonly name = 'TimeoutError';
}

function runWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new TimeoutError(`tool run exceeded ${ms}ms`)),
      ms,
    );
    // Don't keep the event loop alive just for this timer.
    timer.unref?.();
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}