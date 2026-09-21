import { z } from 'zod';
import { BUILTIN_TOOL_NAMES } from '../tools/builtin/registry.js';

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

export const ConfigSchema = z.object({
  name: z.string().min(1),
  version: z.string().default('0.0.0'),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  provider: ProviderSchema.default('anthropic'),
  model: z.string().optional(),
  maxIterations: z.number().int().positive().default(20),
  skills: z.array(SkillSchema).default([]),
  tools: z.array(ToolSchema).default([]),
});

export type SkillConfig = z.infer<typeof SkillSchema>;
export type ToolConfig = z.infer<typeof ToolSchema>;
export type Provider = z.infer<typeof ProviderSchema>;
export type Config = z.infer<typeof ConfigSchema>;