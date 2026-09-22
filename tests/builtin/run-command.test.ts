import { describe, expect, it } from 'vitest';
import path from 'node:path';
import '../../src/tools/builtin/tools/run-command.js';
import { getBuiltinTool } from '../../src/tools/builtin/registry.js';

describe('run_command builtin', () => {
  it('denies when no permission is set', async () => {
    const tool = getBuiltinTool('run_command');
    await expect(tool.run({ command: 'echo hi', cwd: process.cwd() })).rejects.toThrow(
      /denied by default/,
    );
  });

  it('rejects when cwd is missing', async () => {
    const tool = getBuiltinTool('run_command', {
      expression: 'echo *',
      extraPatterns: [],
    });
    await expect(tool.run({ command: 'echo hi' })).rejects.toThrow(/"cwd" is required/);
  });

  it('rejects when cwd is empty string', async () => {
    const tool = getBuiltinTool('run_command', {
      expression: 'echo *',
      extraPatterns: [],
    });
    await expect(tool.run({ command: 'echo hi', cwd: '' })).rejects.toThrow(
      /"cwd" is required/,
    );
  });

  it('denies commands not matching any pattern', async () => {
    const tool = getBuiltinTool('run_command', {
      expression: 'git *',
      extraPatterns: [],
    });
    await expect(
      tool.run({ command: 'rm -rf /', cwd: process.cwd() }),
    ).rejects.toThrow(/not in permission/);
  });

  it('runs allowed commands and returns output', async () => {
    const tool = getBuiltinTool('run_command', {
      expression: 'echo *',
      extraPatterns: [],
    });
    const result = await tool.run({ command: 'echo hello world', cwd: process.cwd() });
    expect(result).toMatchObject({ ok: true, exitCode: 0 });
    expect((result as any).stdout.trim()).toBe('hello world');
  });

  it('captures non-zero exit codes as ok=false', async () => {
    const tool = getBuiltinTool('run_command', {
      expression: 'false',
      extraPatterns: [],
    });
    const result = await tool.run({ command: 'false', cwd: process.cwd() });
    expect((result as any).ok).toBe(false);
    expect((result as any).exitCode).not.toBe(0);
  });

  it('times out long-running commands', async () => {
    const tool = getBuiltinTool('run_command', {
      expression: 'sleep *',
      extraPatterns: [],
    });
    await expect(
      tool.run({ command: 'sleep 5', cwd: process.cwd(), timeoutMs: 200 }),
    ).rejects.toThrow(/timed out/);
  }, 5_000);

  it('OR-combines expression and extraPatterns', async () => {
    const tool = getBuiltinTool('run_command', {
      expression: 'echo *',
      extraPatterns: ['false'],
    });
    expect(
      ((await tool.run({ command: 'echo hi', cwd: process.cwd() })) as any).ok,
    ).toBe(true);
    expect(
      ((await tool.run({ command: 'false', cwd: process.cwd() })) as any).ok,
    ).toBe(false);
  });

  it('end-to-end: permission: ["git *","npm test"] allows each', async () => {
    // Drive through the actual resolvePermissions path so we test the full
    // schema → resolver → tool plumbing, not just the factory.
    const { resolvePermissions } = await import('../../src/tools/builtin/permissions.js');
    const perms = await resolvePermissions(
      { permission: ['git *', 'echo *'] },
      path.resolve('tests/fixtures'),
    );
    const tool = getBuiltinTool('run_command', perms);
    expect(((await tool.run({ command: 'echo ok', cwd: process.cwd() })) as any).ok).toBe(true);
    await expect(
      tool.run({ command: 'rm -rf /', cwd: process.cwd() }),
    ).rejects.toThrow(/not in permission/);
  });
});