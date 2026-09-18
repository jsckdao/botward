import type { LoadedTool } from './sandbox.js';
import type { ToolSpec } from '../llm/types.js';

/**
 * Build provider-native tool specs from loaded tools. The adapters consume
 * these and re-shape them per provider.
 */
export function toToolSpecs(tools: LoadedTool[]): ToolSpec[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

/**
 * Look up a tool by name. Throws if absent — this indicates a bug (LLM
 * hallucinated a tool name) rather than a recoverable runtime condition.
 */
export function getTool(tools: LoadedTool[], name: string): LoadedTool {
  const found = tools.find((t) => t.name === name);
  if (!found) {
    throw new Error(`unknown tool requested by LLM: ${name}`);
  }
  return found;
}