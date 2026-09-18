import fs from 'node:fs/promises';
import path from 'node:path';
import { BotwardError } from '../../../utils/errors.js';
import type { LoadedTool, ResolvedPermissions } from '../../sandbox.js';
import { globToRegex, matchGlob } from '../matchers/glob.js';
import { registerBuiltin } from '../registry.js';

const DEFAULT_LIMIT = 1_000;

function build(permissions?: ResolvedPermissions): LoadedTool {
  return {
    name: 'list_files',
    description:
      'List files under a directory using a glob pattern. PERMISSION DENIED by default — set `permission` (glob) for the root path you want to expose.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern relative to `cwd` (e.g. "**/*.js").',
          default: '**/*',
        },
        cwd: {
          type: 'string',
          description: 'Directory to search. Defaults to process cwd.',
        },
        limit: {
          type: 'number',
          description: 'Max entries to return (default 1000).',
          default: DEFAULT_LIMIT,
        },
      },
    },
    run: async (args, perms) => {
      const cwd = path.resolve(String(args.cwd ?? '.'));
      const pattern = String(args.pattern ?? '**/*');
      const limit = Number(args.limit ?? DEFAULT_LIMIT);
      const effective = perms ?? permissions;

      // Permission must allow the cwd itself.
      if (!isAllowed(cwd, effective)) {
        throw new BotwardError(
          `list_files denied: cwd "${cwd}" not in permission allowlist`,
        );
      }

      const fullPattern = pattern.includes('/') ? pattern : `**/${pattern}`;
      const re = globToRegex(fullPattern);

      const out: string[] = [];
      await walk(cwd, async (absPath) => {
        if (out.length >= limit) return;
        const rel = path.relative(cwd, absPath).split(path.sep).join('/');
        if (re.test(rel)) out.push(absPath);
      });

      return {
        ok: true,
        cwd,
        pattern: fullPattern,
        count: out.length,
        truncated: false,
        files: out,
      };
    },
    maxOutputBytes: 50_000,
    timeoutMs: 10_000,
    permissions,
  };
}

async function walk(
  dir: string,
  visit: (abs: string) => Promise<void>,
): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // Skip unreadable dirs.
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(abs, visit);
    } else if (entry.isFile()) {
      await visit(abs);
    }
  }
}

function isAllowed(target: string, perms: ResolvedPermissions | undefined): boolean {
  if (!perms) return false;
  const patterns: string[] = [];
  if (perms.expression) patterns.push(perms.expression);
  patterns.push(...perms.extraPatterns);
  if (patterns.length === 0) return false;
  return patterns.some((p) => matchGlob(target, p) || matchGlob(target + '/', p + '/**'));
}

registerBuiltin('list_files', build);