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

export type SkillConfig = z.infer<typeof SkillSchema>;
export type ToolConfig = z.infer<typeof ToolSchema>;
export type Provider = z.infer<typeof ProviderSchema>;
export type Config = z.infer<typeof ConfigSchema>;