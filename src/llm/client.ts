import type { LLMClient } from './types.js';

/**
 * Build the provider-native tool spec list that the adapters consume.
 * Both providers accept (essentially) the same JSON Schema under different keys;
 * we keep one shape and let the adapter rewrite it.
 */
export function toToolSpecs(
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[],
) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export type { LLMClient };