import { describe, expect, it } from 'vitest';
import '../../src/tools/builtin/tools/run-command.js';
import { getBuiltinTool } from '../../src/tools/builtin/registry.js';

describe('run_command builtin', () => {
  it('denies when no permission is set', async () => {
    const tool = getBuiltinTool('run_command');
    await expect(tool.run({ command: 'echo hi' })).rejects.toThrow(/denied by default/);
  });

  it('denies commands not matching any pattern', async () => {
    const tool = getBuiltinTool('run_command', {
      expression: 'git *',
      extraPatterns: [],
    });
    await expect(tool.run({ command: 'rm -rf /' })).rejects.toThrow(/not in permission/);
  });

  it('runs allowed commands and returns output', async () => {
    const tool = getBuiltinTool('run_command', {
      expression: 'echo *',
      extraPatterns: [],
    });
    const result = await tool.run({ command: 'echo hello world' });
    expect(result).toMatchObject({ ok: true, exitCode: 0 });
    expect((result as any).stdout.trim()).toBe('hello world');
  });

  it('captures non-zero exit codes as ok=false', async () => {
    const tool = getBuiltinTool('run_command', {
      expression: 'false',
      extraPatterns: [],
    });
    const result = await tool.run({ command: 'false' });
    expect((result as any).ok).toBe(false);
    expect((result as any).exitCode).not.toBe(0);
  });

  it('times out long-running commands', async () => {
    const tool = getBuiltinTool('run_command', {
      expression: 'sleep *',
      extraPatterns: [],
    });
    await expect(
      tool.run({ command: 'sleep 5', timeoutMs: 200 }),
    ).rejects.toThrow(/timed out/);
  }, 5_000);

  it('OR-combines expression and extraPatterns', async () => {
    const tool = getBuiltinTool('run_command', {
      expression: 'echo *',
      extraPatterns: ['false'],
    });
    expect(((await tool.run({ command: 'echo hi' })) as any).ok).toBe(true);
    expect(((await tool.run({ command: 'false' })) as any).ok).toBe(false);
  });
});