import pLimit from "p-limit";
import pRetry from "p-retry";

export type BatchOptions = {
  concurrency?: number;
  retries?: number;
  onProgress?: (info: { done: number; total: number }) => void;
};

/**
 * Detect rate limit / quota errors in a vendor-agnostic way
 */
export function isRateLimitError(err: any): boolean {
  if (!err) return false;

  const status =
    err.status ??
    err.statusCode ??
    err.response?.status ??
    err.response?.statusCode;

  if (status === 429) return true;

  const msg = String(err.message || err.error || "").toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("quota")
  );
}

/**
 * Process items in parallel with controlled concurrency and retry on rate limits
 */
export async function batchProcess<T, R>(
  items: T[],
  handler: (item: T, index: number) => Promise<R>,
  options: BatchOptions = {},
): Promise<R[]> {
  const {
    concurrency = 2,
    retries = 3,
    onProgress,
  } = options;

  const limit = pLimit(concurrency);
  const results: R[] = new Array(items.length);
  let done = 0;

  await Promise.all(
    items.map((item, index) =>
      limit(async () => {
        const result = await pRetry(
          async () => handler(item, index),
          {
            retries,
            onFailedAttempt: (error) => {
              if (!isRateLimitError(error)) {
                throw error;
              }
            },
          },
        );

        results[index] = result;
        done++;
        onProgress?.({ done, total: items.length });
      }),
    ),
  );

  return results;
}

/**
 * Same as batchProcess, but emits progress via SSE
 */
export async function batchProcessWithSSE<T, R>(
  items: T[],
  handler: (item: T, index: number) => Promise<R>,
  send: (data: any) => void,
  options: BatchOptions = {},
): Promise<(R | { ok: false; error: string })[]> {
  const {
    concurrency = 2,
    retries = 3,
  } = options;

  const limit = pLimit(concurrency);
  const results: (R | { ok: false; error: string })[] = new Array(items.length);
  let done = 0;

  await Promise.all(
    items.map((item, index) =>
      limit(async () => {
        try {
          const result = await pRetry(
            async () => handler(item, index),
            {
              retries,
              onFailedAttempt: (error) => {
                if (!isRateLimitError(error)) {
                  throw error;
                }
              },
            },
          );

          results[index] = result;
        } catch (err: any) {
          results[index] = {
            ok: false,
            error: err?.message || "Failed",
          };
        }

        done++;
        send({
          type: "progress",
          done,
          total: items.length,
        });
      }),
    ),
  );

  send({ type: "done" });
  return results;
}
