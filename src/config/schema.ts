import { z } from 'zod';
import { BUILTIN_TOOL_NAMES } from '../tools/builtin/registry.js';
import { parseContextLength } from './units.js';

/**
 * Skill can be inline (`content`) or a directory of files (`dir`).
 * At least one is required. Both is allowed — `content` wins when present.
 */
export const SkillSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().default(''),
    content: z.string().optional(),
    dir: z.string().optional(),
  })
  .refine((s) => s.content !== undefined || s.dir !== undefined, {
    message: 'skill must define either "content" or "dir"',
  });

/**
 * Tool must have exactly one of `code` (inline CJS) or `file` (path to CJS
 * file) — UNLESS its name is in BUILTIN_TOOL_NAMES, in which case neither is
 * required (the loader dispatches to a built-in factory instead).
 *
 * `permission` (string) and `permissionFile` (string path to JSON array of
 * patterns) are tool-defined allowlists; built-in tools enforce them, user
 * tools receive them via the second arg of run(input, permissions).
 */
export const ToolSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().default(''),
    inputSchema: z
      .record(z.unknown())
      .default({ type: 'object', properties: {}, additionalProperties: true }),
    code: z.string().optional(),
    file: z.string().optional(),
    // Hard cap on tool output to protect the context window.
    maxOutputBytes: z.number().int().positive().optional(),
    // Hard cap on each tool run() call.
    timeoutMs: z.number().int().positive().optional(),
    // Permission expression — syntax defined per built-in tool, ignored by
    // user tools unless they opt in. Accepts a single pattern or an array
    // (each entry OR-combined with `permissionFile` entries).
    permission: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .optional(),
    // Path to a JSON array of strings, joined with `permission` as OR.
    permissionFile: z.string().optional(),
  })
  .superRefine((t, ctx) => {
    const isBuiltin = BUILTIN_TOOL_NAMES.has(t.name);
    if (!isBuiltin && (t.code !== undefined) === (t.file !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'tool must define exactly one of "code" or "file"',
        path: ['code'],
      });
    }
  });

export const ProviderSchema = z.enum(['anthropic', 'openai']);

/**
 * Context length accepts either a raw positive integer or a string with a
 * unit suffix (`"256k"`, `"1m"`, `"262144"`). Internal storage is always a
 * positive integer representing tokens. See `src/config/units.ts` for the
 * accepted grammar.
 */
export const ContextLengthSchema = z
  .union([z.number().int().positive(), z.string().min(1)])
  .transform((v, ctx) => {
    if (typeof v === 'number') return v;
    const parsed = parseContextLength(v);
    if (parsed === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `invalid context length "${v}" (expected forms: "256k", "1m", "262144")`,
      });
      return z.NEVER;
    }
    return parsed;
  });

/** Trigger ratio in (0, 1) — fires compression when lastInputTokens / maxContextLength >= ratio. */
export const ContextCompressionRatioSchema = z.number().min(0.1).max(0.99);

export const ConfigSchema = z.object({
  name: z.string().min(1),
  version: z.string().default('0.0.0'),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  provider: ProviderSchema.default('anthropic'),
  model: z.string().optional(),
  maxIterations: z.number().int().positive().default(50),
  // Master switch for context compression. When false, compression is skipped
  // entirely and the LLM surfaces its own context-window errors.
  contextCompression: z.boolean().default(true),
  // Total input-token budget for system + tools + messages.
  maxContextLength: ContextLengthSchema.default(262_144),
  // Trigger ratio. When lastInputTokens / maxContextLength >= ratio, compress
  // before the next llm.chat call.
  maxContextLengthRatio: ContextCompressionRatioSchema.default(0.9),
  skills: z.array(SkillSchema).default([]),
  tools: z.array(ToolSchema).default([]),
});

/**
 * Public types — declared as plain interfaces (not `z.infer<>`) so the bundled
 * `.d.ts` doesn't have to redeclare every zod schema. The schemas validate user
 * JSON at runtime; these interfaces describe the parsed shape.
 *
 * The `Inferred*` aliases below stay as `z.infer<>` and are used only by the
 * compile-time cross-check to confirm the schemas stay in sync.
 */
export interface SkillConfig {
  name: string;
  description: string;
  content?: string;
  dir?: string;
}

export interface ToolConfig {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  code?: string;
  file?: string;
  maxOutputBytes?: number;
  timeoutMs?: number;
  permission?: string | string[];
  permissionFile?: string;
}

export type Provider = 'anthropic' | 'openai';

export interface Config {
  name: string;
  version: string;
  description?: string;
  systemPrompt?: string;
  provider: Provider;
  model?: string;
  maxIterations: number;
  contextCompression: boolean;
  maxContextLength: number;
  maxContextLengthRatio: number;
  skills: SkillConfig[];
  tools: ToolConfig[];
}

// Compile-time cross-check: if a schema field drifts, the inferred type
// diverges from the public interface and these `extends` checks fail.
type InferredSkill = z.infer<typeof SkillSchema>;
type InferredTool = z.infer<typeof ToolSchema>;
type InferredProvider = z.infer<typeof ProviderSchema>;
type InferredConfig = z.infer<typeof ConfigSchema>;
type _SkillMatch = [InferredSkill] extends [SkillConfig]
  ? [SkillConfig] extends [InferredSkill]
    ? true
    : never
  : never;
type _ToolMatch = [InferredTool] extends [ToolConfig]
  ? [ToolConfig] extends [InferredTool]
    ? true
    : never
  : never;
type _ProviderMatch = [InferredProvider] extends [Provider]
  ? [Provider] extends [InferredProvider]
    ? true
    : never
  : never;
type _ConfigMatch = [InferredConfig] extends [Config]
  ? [Config] extends [InferredConfig]
    ? true
    : never
  : never;
const _schemaMatches: [_SkillMatch, _ToolMatch, _ProviderMatch, _ConfigMatch] = [
  true,
  true,
  true,
  true,
];
void _schemaMatches;