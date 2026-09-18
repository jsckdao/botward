/**
 * Minimal logger that writes to stderr so stdout stays clean for piping.
 */
export const logger = {
  info(msg: string): void {
    process.stderr.write(`[botward] ${msg}\n`);
  },
  warn(msg: string): void {
    process.stderr.write(`[botward] warn: ${msg}\n`);
  },
  error(msg: string): void {
    process.stderr.write(`[botward] error: ${msg}\n`);
  },
  tool(name: string, preview: string): void {
    const short = preview.length > 200 ? `${preview.slice(0, 200)}...` : preview;
    process.stderr.write(`[botward] tool: ${name} -> ${short}\n`);
  },
};