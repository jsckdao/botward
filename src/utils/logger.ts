import pc from 'picocolors';

/**
 * Minimal logger that writes to stderr so stdout stays clean for piping.
 *
 * Colors are on when stderr is a TTY (a human is watching) and off otherwise
 * (logs piped to a file, CI capture, etc.) — we always want greppable plain
 * text on disk. Use `process.env.NO_COLOR` to force-disable even on a TTY.
 */
const c = pc.createColors(
  pc.isColorSupported &&
    Boolean(process.stderr.isTTY) &&
    !process.env.NO_COLOR &&
    !process.env.CI,
);

const PREFIX = `${c.gray('[botward]')}`;
const SEP = c.gray(':');

export const logger = {
  info(msg: string): void {
    process.stderr.write(`${PREFIX} ${msg}\n`);
  },
  warn(msg: string): void {
    process.stderr.write(`${PREFIX} ${c.yellow('warn')}${SEP} ${msg}\n`);
  },
  error(msg: string): void {
    process.stderr.write(`${PREFIX} ${c.red('error')}${SEP} ${msg}\n`);
  },
  tool(name: string, preview: string): void {
    const short = preview.length > 200 ? `${preview.slice(0, 200)}...` : preview;
    process.stderr.write(
      `${PREFIX} ${c.cyan('tool')}${SEP} ${c.bold(name)} -> ${short}\n`,
    );
  },
};