import fs from 'node:fs/promises';
import path from 'node:path';
import { BotwardError } from '../../../utils/errors.js';
import type { LoadedTool, ResolvedPermissions } from '../../sandbox.js';
import { globToRegex, matchGlob } from '../matchers/glob.js';
import { registerBuiltin } from '../registry.js';

const DEFAULT_MAX_RESULTS = 100;
const DEFAULT_MAX_FILE_BYTES = 1_000_000; // skip larger files

interface Match {
  file: string;
  line: number;
  text: string;
}

function build(permissions?: ResolvedPermissions): LoadedTool {
  return {
    name: 'search_files',
    description:
      'Search files under `cwd` for lines containing `pattern`. PERMISSION DENIED by default — set `permission` (glob) for the root path you want to expose.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Substring or regex to look for.' },
        cwd: { type: 'string', description: 'Directory to search. Defaults to cwd.' },
        glob: {
          type: 'string',
          description: 'Restrict to files matching this glob (relative to cwd). Default: **/*.',
          default: '**/*',
        },
        regex: { type: 'boolean', description: 'Treat `pattern` as a regex.', default: false },
        caseSensitive: { type: 'boolean', default: true },
        maxResults: { type: 'number', default: DEFAULT_MAX_RESULTS },
      },
      required: ['pattern'],
    },
    run: async (args, perms) => {
      const pattern = String(args.pattern ?? '');
      if (!pattern) throw new BotwardError('search_files: "pattern" is required');

      const cwd = path.resolve(String(args.cwd ?? '.'));
      const globPattern = String(args.glob ?? '**/*');
      const isRegex = Boolean(args.regex);
      const caseSensitive = args.caseSensitive !== false;
      const maxResults = Number(args.maxResults ?? DEFAULT_MAX_RESULTS);

      const effective = perms ?? permissions;
      if (!isAllowed(cwd, effective)) {
        throw new BotwardError(
          `search_files denied: cwd "${cwd}" not in permission allowlist`,
        );
      }

      let matcher: (line: string) => boolean;
      if (isRegex) {
        let re: RegExp;
        try {
          re = new RegExp(pattern, caseSensitive ? '' : 'i');
        } catch (err) {
          throw new BotwardError(`search_files: invalid regex: ${(err as Error).message}`);
        }
        matcher = (line) => re.test(line);
      } else {
        const needle = caseSensitive ? pattern : pattern.toLowerCase();
        matcher = (line) => {
          const hay = caseSensitive ? line : line.toLowerCase();
          return hay.includes(needle);
        };
      }

      const fileRe = globToRegex(globPattern.includes('/') ? globPattern : `**/${globPattern}`);
      const matches: Match[] = [];
      let truncated = false;

      await walk(cwd, async (absPath) => {
        if (matches.length >= maxResults) {
          truncated = true;
          return;
        }
        const rel = path.relative(cwd, absPath).split(path.sep).join('/');
        if (!fileRe.test(rel)) return;
        let stat;
        try {
          stat = await fs.stat(absPath);
        } catch {
          return;
        }
        if (!stat.isFile() || stat.size > DEFAULT_MAX_FILE_BYTES) return;
        let text: string;
        try {
          text = await fs.readFile(absPath, 'utf-8');
        } catch {
          return; // skip unreadable / non-utf-8 files
        }
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= maxResults) {
            truncated = true;
            break;
          }
          if (matcher(lines[i]!)) {
            matches.push({ file: absPath, line: i + 1, text: lines[i]! });
          }
        }
      });

      return { ok: true, cwd, pattern: globPattern, count: matches.length, truncated, matches };
    },
    maxOutputBytes: 50_000,
    timeoutMs: 30_000,
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

registerBuiltin('search_files', build);