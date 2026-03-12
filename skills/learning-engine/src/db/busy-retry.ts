/**
 * Synchronous busy-retry wrapper for bun:sqlite operations.
 *
 * bun:sqlite is synchronous, so this wrapper must also be synchronous.
 * Previously this was async, which meant all repo write methods returned
 * Promise<T> — callers that forgot `await` would silently lose writes.
 */
const RETRY_BASE_MS = 50;
const RETRY_MAX_MS = 2000;
const RETRY_JITTER_MS = 50;

export function withBusyRetry<T>(fn: () => T, maxRetries = 5): T {
  if (maxRetries <= 0) {
    throw new Error(`withBusyRetry: maxRetries must be > 0, got ${maxRetries}`);
  }
  for (let i = 0; i < maxRetries; i++) {
    try {
      return fn();
    } catch (e: unknown) {
      const code = (e as Record<string, unknown>)?.code;
      const message = (e as Record<string, unknown>)?.message;
      const isBusy =
        code === "SQLITE_BUSY" ||
        (typeof message === "string" && message.includes("SQLITE_BUSY"));
      if (isBusy && i < maxRetries - 1) {
        const delay = Math.min(RETRY_BASE_MS * 2 ** i, RETRY_MAX_MS) + Math.random() * RETRY_JITTER_MS;
        Bun.sleepSync(delay);
        continue;
      }
      throw e;
    }
  }
  throw new Error("unreachable");
}
