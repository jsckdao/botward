import type { Config } from '../config/schema.js';
import type { LLMClient } from './types.js';
import { AnthropicClient } from './anthropic.js';
import { OpenAIClient } from './openai.js';
import { BotwardError } from '../utils/errors.js';

export interface ClientOptions {
  apiKey?: string;
  model?: string;
  baseURL?: string;
}

export function createLLMClient(config: Config, opts: ClientOptions = {}): LLMClient {
  const model = opts.model ?? config.model;
  // baseURL precedence: explicit option > env var
  const baseURL = opts.baseURL ?? envBaseURL(config.provider);

  switch (config.provider) {
    case 'anthropic': {
      const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new BotwardError(
          'ANTHROPIC_API_KEY is not set. Export it in your environment or pass --api-key.',
        );
      }
      return new AnthropicClient({ apiKey, model, baseURL });
    }
    case 'openai': {
      const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new BotwardError(
          'OPENAI_API_KEY is not set. Export it in your environment or pass --api-key.',
        );
      }
      return new OpenAIClient({ apiKey, model, baseURL });
    }
    default: {
      const _exhaustive: never = config.provider;
      throw new BotwardError(`unsupported provider: ${String(_exhaustive)}`);
    }
  }
}

function envBaseURL(provider: 'anthropic' | 'openai'): string | undefined {
  switch (provider) {
    case 'anthropic':
      return process.env.ANTHROPIC_BASE_URL;
    case 'openai':
      return process.env.OPENAI_BASE_URL;
  }
}