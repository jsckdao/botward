/**
 * Domain error with a stable name for downstream filtering.
 */
export class BotwardError extends Error {
  override readonly name = 'BotwardError';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}