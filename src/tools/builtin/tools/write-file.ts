import fs from 'node:fs/promises';
import path from 'node:path';
import { BotwardError } from '../../../utils/errors.js';
import type { LoadedTool, ResolvedPermissions } from '../../sandbox.js';
import { matchGlob } from '../matchers/glob.js';
import { registerBuiltin } from '../registry.js';

const DEFAULT_MAX_BYTES = 5_000_000; // 5 MB hard cap on input content

function build(permissions?: ResolvedPermissions): LoadedTool {
  return {
    name: 'write_file',
    description:
      'Write text to a file (create or overwrite). PERMISSION DENIED by default — set `permission` (glob) to allow specific paths.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file (relative paths resolved against cwd).' },
        content: { type: 'string', description: 'Text content to write.' },
        mode: {
          type: 'string',
          enum: ['overwrite', 'append'],
          default: 'overwrite',
          description: '"overwrite" replaces the file; "append" adds to it.',
        },
      },
      required: ['path', 'content'],
    },
    run: async (args, perms) => {
      const rawPath = String(args.path ?? '');
      if (!rawPath) throw new BotwardError('write_file: "path" is required');
      const content = String(args.content ?? '');
      if (Buffer.byteLength(content, 'utf-8') > DEFAULT_MAX_BYTES) {
        throw new BotwardError(
          `write_file: content exceeds ${DEFAULT_MAX_BYTES} bytes`,
        );
      }

      const abs = path.resolve(rawPath);
      const effective = perms ?? permissions;
      if (!isAllowed(abs, effective)) {
        throw new BotwardError(
          `write_file denied: "${abs}" not in permission allowlist`,
        );
      }

      const mode = String(args.mode ?? 'overwrite');
      if (mode === 'append') {
        await fs.appendFile(abs, content, 'utf-8');
      } else {
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content, 'utf-8');
      }

      return { ok: true, path: abs, bytes: Buffer.byteLength(content, 'utf-8'), mode };
    },
    maxOutputBytes: 50_000,
    timeoutMs: 10_000,
    permissions,
  };
}

function isAllowed(target: string, perms: ResolvedPermissions | undefined): boolean {
  if (!perms) return false;
  const patterns: string[] = [];
  if (perms.expression) patterns.push(perms.expression);
  patterns.push(...perms.extraPatterns);
  if (patterns.length === 0) return false;
  return patterns.some((p) => matchGlob(target, p));
}

registerBuiltin('write_file', build);