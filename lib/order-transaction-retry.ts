import { Prisma } from "@prisma/client";

/**
 * POST /api/orders (SCALE-FIX-1 A7). The order transaction (Serializable, stock rows locked in id order) is unchanged.
 * This module only adds:
 *  - a short retry of the WHOLE transaction when PostgreSQL rejects it with a serialization or write conflict.
 *    Prisma reports it as P2034, or, when it comes from a raw query such as the route's `SELECT ... FOR UPDATE` on a
 *    stock row, as P2010 with meta.code "40001" (verified on PostgreSQL, scripts/scale-fix-1.integration.test.ts;
 *    owner decision 2026-11-19 to retry both). Several buyers of the same product at the same moment hit this even
 *    when stock is enough. Nothing else is retried, not even other P2010 raw-query errors. A conflict means PostgreSQL rolled the attempt back, so a retry is a fresh
 *    attempt: a second submit of the same cart still finds the cart emptied by the first and gets CART_EMPTY (409).
 * The Azerbaijani stock-error messages (409 instead of 500) are in lib/order-stock-errors.ts, which the checkout
 * form also imports (no Prisma there).
 */
export const ORDER_TRANSACTION_MAX_RETRIES = 2;

export function isOrderSerializationConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2034") return true;
  // SQLSTATE 40001 (serialization_failure) from a raw query.
  return error.code === "P2010" && (error.meta as { code?: unknown } | undefined)?.code === "40001";
}

/** Delay before retry n (1-based): random 25-100 ms, then 50-200 ms, so competing buyers do not retry in lockstep. */
export function orderRetryDelayMs(retry: number, random: () => number = Math.random): number {
  return Math.round((25 + random() * 75) * retry);
}

export async function withOrderSerializationRetry<T>(
  run: () => Promise<T>,
  options: { retries?: number; sleep?: (ms: number) => Promise<void>; random?: () => number } = {},
): Promise<T> {
  const retries = options.retries ?? ORDER_TRANSACTION_MAX_RETRIES;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isOrderSerializationConflict(error) || attempt >= retries) throw error;
      await sleep(orderRetryDelayMs(attempt + 1, options.random));
    }
  }
}
