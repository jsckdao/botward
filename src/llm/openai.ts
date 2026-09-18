import OpenAI from 'openai';
import type {
  ChatRequest,
  ChatResponse,
  LLMClient,
  StopReason,
  ToolCall,
  UnifiedMessage,
} from './types.js';
import { BotwardError } from '../utils/errors.js';

const DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * Adapter that translates between our unified types and OpenAI's Chat
 * Completions API. Handles the `tool_calls` parallel field on assistant
 * messages and the per-result `role: 'tool'` messages that OpenAI requires.
 */
export class OpenAIClient implements LLMClient {
  private client: OpenAI;
  private model: string;

  constructor(opts: { apiKey: string; model?: string; baseURL?: string }) {
    if (!opts.apiKey) {
      throw new BotwardError('OPENAI_API_KEY is not set');
    }
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    });
    this.model = opts.model ?? DEFAULT_MODEL;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [];

    // OpenAI expects system prompt as the first role='system' message.
    if (req.system) {
      messages.push({ role: 'system', content: req.system });
    }

    for (const m of req.messages) {
      messages.push(...toOpenAIMessages(m));
    }

    const tools: OpenAI.ChatCompletionTool[] = req.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as OpenAI.FunctionParameters,
      },
    }));

    try {
      const resp = await this.client.chat.completions.create({
        model: req.model ?? this.model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature,
      });

      const choice = resp.choices[0];
      if (!choice) {
        throw new BotwardError('OpenAI returned no choices');
      }
      return fromOpenAIResponse(choice, resp.usage);
    } catch (err) {
      if (err instanceof BotwardError) throw err;
      throw new BotwardError(
        `OpenAI request failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }
}

// ---- helpers --------------------------------------------------------------

function toOpenAIMessages(m: UnifiedMessage): OpenAI.ChatCompletionMessageParam[] {
  if (m.role === 'assistant') {
    const text = typeof m.content === 'string'
      ? m.content
      : m.content.map((b) => b.text).join('');
    const toolCalls: OpenAI.ChatCompletionMessageToolCall[] | undefined =
      m.toolCalls && m.toolCalls.length > 0
        ? m.toolCalls.map((c) => ({
            id: c.id,
            type: 'function',
            function: {
              name: c.name,
              // OpenAI requires arguments as a JSON STRING.
              arguments: JSON.stringify(c.arguments),
            },
          }))
        : undefined;

    const msg: OpenAI.ChatCompletionAssistantMessageParam = {
      role: 'assistant',
      content: text || null,
    };
    if (toolCalls) msg.tool_calls = toolCalls;
    return [msg];
  }

  // user message with tool results → emit one role:'tool' message per result
  if (m.toolResults && m.toolResults.length > 0) {
    return m.toolResults.map<OpenAI.ChatCompletionToolMessageParam>((r) => ({
      role: 'tool',
      tool_call_id: r.toolCallId,
      content: r.content,
    }));
  }

  // plain user text
  const text = typeof m.content === 'string'
    ? m.content
    : m.content.map((b) => b.text).join('');
  return [{ role: 'user', content: text }];
}

function fromOpenAIResponse(
  choice: OpenAI.ChatCompletion.Choice,
  usage?: OpenAI.CompletionUsage,
): ChatResponse {
  const message = choice.message;
  const text = message.content ?? '';
  const toolCalls: ToolCall[] = [];

  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      if (tc.type !== 'function') continue;
      let parsed: Record<string, unknown> = {};
      try {
        const raw = tc.function.arguments;
        if (raw && raw.trim().length > 0) {
          parsed = JSON.parse(raw) as Record<string, unknown>;
        }
      } catch {
        parsed = {};
      }
      toolCalls.push({
        id: tc.id,
        name: tc.function.name,
        arguments: parsed,
      });
    }
  }

  return {
    message: {
      role: 'assistant',
      content: text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    },
    stopReason: mapStopReason(choice.finish_reason),
    usage: usage
      ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }
      : undefined,
  };
}

function mapStopReason(reason: OpenAI.ChatCompletion.Choice['finish_reason']): StopReason {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'stop_sequence';
    default:
      return 'end_turn';
  }
}