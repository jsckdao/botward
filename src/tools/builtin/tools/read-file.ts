import fs from 'node:fs/promises';
import path from 'node:path';
import { BotwardError } from '../../../utils/errors.js';
import type { LoadedTool, ResolvedPermissions } from '../../sandbox.js';
import { matchGlob } from '../matchers/glob.js';
import { registerBuiltin } from '../registry.js';

const DEFAULT_MAX_BYTES = 5_000_000; // 5 MB hard cap regardless of permission

function build(permissions?: ResolvedPermissions): LoadedTool {
  return {
    name: 'read_file',
    description:
      'Read the contents of a text file. PERMISSION DENIED by default — set `permission` (glob) to allow specific paths.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file (relative paths resolved against the botward process cwd).',
        },
        encoding: {
          type: 'string',
          enum: ['utf-8', 'base64'],
          default: 'utf-8',
          description: 'How to encode the file bytes in the response.',
        },
      },
      required: ['path'],
    },
    run: async (args, perms) => {
      const rawPath = String(args.path ?? '');
      if (!rawPath) throw new BotwardError('read_file: "path" is required');

      const abs = path.resolve(rawPath);
      const effective = perms ?? permissions;
      if (!isAllowed(abs, effective)) {
        throw new BotwardError(
          `read_file denied: "${abs}" not in permission allowlist`,
        );
      }

      const encoding = String(args.encoding ?? 'utf-8');
      const buf = await fs.readFile(abs);
      if (buf.length > DEFAULT_MAX_BYTES) {
        throw new BotwardError(
          `read_file: file too large (${buf.length} > ${DEFAULT_MAX_BYTES} bytes)`,
        );
      }
      return {
        ok: true,
        path: abs,
        bytes: buf.length,
        content: encoding === 'base64' ? buf.toString('base64') : buf.toString('utf-8'),
      };
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

registerBuiltin('read_file', build);