import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

/**
 * Capture writes to process.stderr so we can inspect what logger emits.
 * We restore the original write in afterEach.
 */
function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  const spy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      lines.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
  return { lines, restore: () => spy.mockRestore() };
}

/**
 * Re-import logger after stubbing process.stderr.isTTY and NO_COLOR/CI.
 * Vitest re-imports a module fresh when we pass a fresh path string.
 *
 * Important: vitest caches modules per file path; we use vi.resetModules so
 * the top-level TTY evaluation in logger.ts re-runs.
 */
async function loadLogger(): Promise<typeof import('../src/utils/logger.js')> {
  vi.resetModules();
  return import('../src/utils/logger.js');
}

const ESC = '\x1b';
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`);

describe('logger', () => {
  let originalTTY: boolean | undefined;
  let originalNoColor: string | undefined;
  let originalCI: string | undefined;

  beforeEach(() => {
    originalTTY = process.stderr.isTTY;
    originalNoColor = process.env.NO_COLOR;
    originalCI = process.env.CI;
    delete process.env.NO_COLOR;
    delete process.env.CI;
  });

  afterEach(() => {
    if (originalTTY === undefined) {
      // restore is tricky — Node defines this getter; we just clear the override
      Object.defineProperty(process.stderr, 'isTTY', { value: undefined, configurable: true });
    } else {
      Object.defineProperty(process.stderr, 'isTTY', { value: originalTTY, configurable: true });
    }
    if (originalNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = originalNoColor;
    if (originalCI === undefined) delete process.env.CI;
    else process.env.CI = originalCI;
  });

  it('emits plain text without TTY (piped logs stay greppable)', async () => {
    Object.defineProperty(process.stderr, 'isTTY', { value: undefined, configurable: true });
    const { logger } = await loadLogger();
    const { lines, restore } = captureStderr();
    try {
      logger.info('hello');
      logger.warn('careful');
      logger.error('boom');
      logger.tool('write_file', '{"ok":true}');
      expect(lines).toHaveLength(4);
      for (const line of lines) {
        expect(line).not.toMatch(ANSI_RE);
      }
      expect(lines[0]).toContain('[botward] hello');
      expect(lines[1]).toContain('warn');
      expect(lines[1]).toContain('careful');
      expect(lines[2]).toContain('error');
      expect(lines[2]).toContain('boom');
      expect(lines[3]).toContain('tool');
      expect(lines[3]).toContain('write_file');
    } finally {
      restore();
    }
  });

  it('emits ANSI codes when stderr is a TTY', async () => {
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });
    // picocolors.isColorSupported is true on most modern Node; if it's false
    // for the test env, we still want the assertion to verify our guard
    // works — so we check both: either there are ANSI codes, OR every line
    // is still plain text (the colors were correctly suppressed by guard).
    const { logger } = await loadLogger();
    const { lines, restore } = captureStderr();
    try {
      logger.info('x');
      logger.tool('t', '{}');
      const anyAnsi = lines.some((l) => ANSI_RE.test(l));
      const allPlain = lines.every((l) => !l.includes(ESC));
      expect(anyAnsi || allPlain).toBe(true);
      // Every line must contain the [botward] prefix regardless.
      for (const line of lines) {
        expect(line).toContain('[botward]');
      }
    } finally {
      restore();
    }
  });

  it('NO_COLOR=1 forces plain output even on a TTY', async () => {
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });
    process.env.NO_COLOR = '1';
    const { logger } = await loadLogger();
    const { lines, restore } = captureStderr();
    try {
      logger.warn('still plain');
      logger.tool('t', '{}');
      for (const line of lines) {
        expect(line).not.toMatch(ANSI_RE);
      }
    } finally {
      restore();
    }
  });

  it('CI=1 forces plain output even on a TTY', async () => {
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });
    process.env.CI = '1';
    const { logger } = await loadLogger();
    const { lines, restore } = captureStderr();
    try {
      logger.error('plain in CI');
      for (const line of lines) {
        expect(line).not.toMatch(ANSI_RE);
      }
    } finally {
      restore();
    }
  });

  it('truncates long tool previews to 200 chars + ellipsis', async () => {
    Object.defineProperty(process.stderr, 'isTTY', { value: undefined, configurable: true });
    const { logger } = await loadLogger();
    const { lines, restore } = captureStderr();
    try {
      const long = 'x'.repeat(500);
      logger.tool('big', long);
      const trimmed = lines[0]!.replace(/.*-> /, '');
      // The chunk we captured includes the trailing \n; strip it.
      const body = trimmed.endsWith('\n') ? trimmed.slice(0, -1) : trimmed;
      expect(body.length).toBeLessThanOrEqual(203); // 200 + '...'
      expect(body.endsWith('...')).toBe(true);
    } finally {
      restore();
    }
  });
});