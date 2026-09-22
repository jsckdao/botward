import { spawn } from 'node:child_process';
import { BotwardError } from '../../../utils/errors.js';
import type { LoadedTool, ResolvedPermissions } from '../../sandbox.js';
import { matchCommand } from '../matchers/command.js';
import { registerBuiltin } from '../registry.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000; // 1 MB combined stdout/stderr

function build(permissions?: ResolvedPermissions): LoadedTool {
  return {
    name: 'run_command',
    description:
      'Run a shell command. PERMISSION DENIED by default — set `permission` (command pattern like "git *" or "npm install") to allow specific commands.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Full command string, e.g. "git status".' },
        cwd: { type: 'string', description: 'Working directory the command runs in. Required.' },
        timeoutMs: { type: 'number', description: 'Kill the process after this many ms (default 30000).' },
      },
      required: ['command', 'cwd'],
    },
    run: async (args, perms) => {
      const cmd = String(args.command ?? '').trim();
      if (!cmd) throw new BotwardError('run_command: "command" is required');

      const cwdRaw = args.cwd;
      if (typeof cwdRaw !== 'string' || cwdRaw.length === 0) {
        throw new BotwardError('run_command: "cwd" is required');
      }
      const cwd = cwdRaw;

      const effective = perms ?? permissions;
      if (!effective || (effective.expression === undefined && effective.extraPatterns.length === 0)) {
        throw new BotwardError(
          'run_command denied by default — set "permission" in config to allow specific commands',
        );
      }

      const patterns: string[] = [];
      if (effective.expression) patterns.push(effective.expression);
      patterns.push(...effective.extraPatterns);
      if (!patterns.some((p) => matchCommand(cmd, p))) {
        throw new BotwardError(
          `run_command denied: "${cmd}" not in permission allowlist`,
        );
      }

      const timeoutMs = Number(args.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      return await runWithKill(cmd, { cwd, timeoutMs });
    },
    maxOutputBytes: 50_000,
    timeoutMs: 60_000,
    permissions,
  };
}

interface RunOptions {
  cwd: string;
  timeoutMs: number;
}

function runWithKill(
  cmd: string,
  opts: RunOptions,
): Promise<{
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, {
      shell: true,
      cwd: opts.cwd,
      // Detached so we can kill the whole process group on timeout.
      detached: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let truncated = false;

    child.stdout?.on('data', (chunk: Buffer) => {
      const total = stdoutChunks.reduce((s, c) => s + c.length, 0) + chunk.length;
      if (total > DEFAULT_MAX_OUTPUT_BYTES) {
        truncated = true;
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const total = stderrChunks.reduce((s, c) => s + c.length, 0) + chunk.length;
      if (total > DEFAULT_MAX_OUTPUT_BYTES) {
        truncated = true;
        return;
      }
      stderrChunks.push(chunk);
    });

    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      // Kill the whole process group so children die too.
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          try { child.kill('SIGKILL'); } catch { /* already gone */ }
        }
      }
    }, opts.timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new BotwardError(`run_command failed to start: ${err.message}`));
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      if (killed) {
        reject(
          new BotwardError(
            `run_command timed out after ${opts.timeoutMs}ms (command: ${cmd})`,
          ),
        );
        return;
      }
      resolve({
        ok: code === 0,
        exitCode: code,
        signal,
        stdout,
        stderr,
        truncated,
      });
    });
  });
}

registerBuiltin('run_command', build);