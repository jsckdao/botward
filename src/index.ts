/**
 * Library entry. The CLI lives at `botward/cli`; this is the programmatic API.
 *
 *   import Botward, { BotwardError } from 'botward';
 */
export { default, Botward } from './api.js';
export type {
  BotwardOptions,
  BotwardProviderConfig,
  ExecuteOptions,
  InitOptions,
  InitResult,
} from './api.js';

// Stable error type so callers can filter with `instanceof`.
export { BotwardError } from './utils/errors.js';

// Schema types — useful for callers who build configs in code or write
// custom adapters against the same LLMClient interface.
export type { Config, Provider, SkillConfig, ToolConfig } from './config/schema.js';
export type { AgentRunResult } from './agent/loop.js';
export type {
  LLMClient,
  ChatRequest,
  ChatResponse,
  UnifiedMessage,
  ToolCall,
  ToolResult,
  ToolSpec,
  StopReason,
} from './llm/types.js';