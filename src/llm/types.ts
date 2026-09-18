/**
 * Provider-agnostic message / tool types. Differences between Anthropic and
 * OpenAI live entirely inside the per-provider adapters.
 */

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface UnifiedMessage {
  role: 'user' | 'assistant';
  /** Plain text or interleaved text blocks. Tool results carry a separate field. */
  content: string | TextBlock[];
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface TextBlock {
  type: 'text';
  text: string;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';

export interface ChatRequest {
  model?: string;
  system: string;
  messages: UnifiedMessage[];
  tools: ToolSpec[];
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResponse {
  message: UnifiedMessage;
  stopReason: StopReason;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LLMClient {
  chat(req: ChatRequest): Promise<ChatResponse>;
}