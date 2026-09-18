import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatRequest,
  ChatResponse,
  LLMClient,
  StopReason,
  TextBlock,
  ToolCall,
  UnifiedMessage,
} from './types.js';
import { BotwardError } from '../utils/errors.js';

const DEFAULT_MODEL = 'claude-sonnet-4-5';

/**
 * Adapter that translates between our unified types and Anthropic's
 * Messages API. All provider quirks (tool_use content blocks, tool_result
 * blocks riding on a user message, etc.) are handled here so the rest of
 * the codebase never sees them.
 */
export class AnthropicClient implements LLMClient {
  private client: Anthropic;
  private model: string;

  constructor(opts: { apiKey: string; model?: string; baseURL?: string }) {
    if (!opts.apiKey) {
      throw new BotwardError('ANTHROPIC_API_KEY is not set');
    }
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    });
    this.model = opts.model ?? DEFAULT_MODEL;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const system = req.system;
    const messages = req.messages.map(toAnthropicMessage);

    const tools = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    try {
      const resp = await this.client.messages.create({
        model: req.model ?? this.model,
        system,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature,
      });
      return fromAnthropicResponse(resp);
    } catch (err) {
      throw new BotwardError(
        `Anthropic request failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }
}

// ---- helpers --------------------------------------------------------------

function toAnthropicMessage(m: UnifiedMessage): Anthropic.MessageParam {
  // assistant message: may contain text blocks AND tool_use blocks.
  if (m.role === 'assistant') {
    const blocks: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = [];
    if (typeof m.content === 'string') {
      if (m.content.length > 0) blocks.push({ type: 'text', text: m.content });
    } else {
      for (const b of m.content) {
        if (b.type === 'text' && b.text.length > 0) {
          blocks.push({ type: 'text', text: b.text });
        }
      }
    }
    if (m.toolCalls) {
      for (const call of m.toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.arguments,
        });
      }
    }
    return { role: 'assistant', content: blocks };
  }

  // user message: either plain text OR a tool_result block(s) when previous
  // assistant turn issued tool calls.
  if (m.toolResults && m.toolResults.length > 0) {
    const blocks: Anthropic.ToolResultBlockParam[] = m.toolResults.map((r) => ({
      type: 'tool_result',
      tool_use_id: r.toolCallId,
      content: r.content,
      is_error: r.isError,
    }));
    return { role: 'user', content: blocks };
  }

  // plain user text
  if (typeof m.content === 'string') {
    return { role: 'user', content: m.content };
  }
  const text = m.content.map((b) => b.text).join('');
  return { role: 'user', content: text };
}

function fromAnthropicResponse(resp: Anthropic.Message): ChatResponse {
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const block of resp.content) {
    if (block.type === 'text') {
      textParts.push(block.text);
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: (block.input ?? {}) as Record<string, unknown>,
      });
    }
  }

  const message: UnifiedMessage = {
    role: 'assistant',
    content: textParts.length > 0 ? textParts.join('') : '',
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };

  const stopReason = mapStopReason(resp.stop_reason);

  const usage = resp.usage
    ? { inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens }
    : undefined;

  return { message, stopReason, usage };
}

function mapStopReason(s: Anthropic.Message['stop_reason']): StopReason {
  switch (s) {
    case 'end_turn':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    default:
      return 'end_turn';
  }
}

// Make TextBlock export live even though it's only used internally here.
// (Re-exported for symmetry with OpenAI adapter.)
export type { TextBlock };