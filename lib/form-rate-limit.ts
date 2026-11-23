import { logAuthFailure } from "@/lib/auth-logging";
import { authRateLimitKey, consumeAuthRateLimit } from "@/lib/auth-rate-limit";

/**
 * SEC-FIX-2 (L8 / L5): database-backed limits for calls that cost something (a stored ticket, an outbound Epoint call,
 * a customer e-mail). Keys are HMAC'd by authRateLimitKey (no raw IP or id is stored). Real users never reach them.
 */
export const SUPPORT_RATE_LIMIT = { limit: 5, windowMs: 15 * 60 * 1000 } as const; // per account
export const SUPPORT_IP_RATE_LIMIT = { limit: 20, windowMs: 15 * 60 * 1000 } as const; // per trusted client IP
export const EPOINT_RECONCILE_RATE_LIMIT = { limit: 20, windowMs: 10 * 60 * 1000 } as const; // per account
export const EPOINT_RECONCILE_IP_RATE_LIMIT = { limit: 60, windowMs: 10 * 60 * 1000 } as const; // per trusted client IP
export const SHIPMENT_EMAIL_ORDER_LIMIT = { limit: 10, windowMs: 24 * 60 * 60 * 1000 } as const; // per store order
export const SHIPMENT_EMAIL_STORE_LIMIT = { limit: 200, windowMs: 60 * 60 * 1000 } as const; // per store

type Scope = Parameters<typeof authRateLimitKey>[0];
export type FormRateBucket = { scope: Scope; identity: string; limit: number; windowMs: number };
export type FormRateLimitDeps = {
  consume: (keyHash: string, limit: number, windowMs: number) => Promise<boolean>;
  log: (stage: string, error: unknown) => void;
};
const defaultDeps: FormRateLimitDeps = { consume: consumeAuthRateLimit, log: logAuthFailure };

/**
 * True while every bucket is under its limit (each call counts in every bucket it reaches). If the rate-limit store
 * fails, the call is ALLOWED and the failure is logged (logAuthFailure): a database blip must not lock everyone out
 * of a form, and it is never skipped silently.
 */
export async function withinFormRateLimits(buckets: FormRateBucket[], stage: string, deps: FormRateLimitDeps = defaultDeps): Promise<boolean> {
  try {
    for (const bucket of buckets) {
      if (!(await deps.consume(authRateLimitKey(bucket.scope, bucket.identity), bucket.limit, bucket.windowMs))) return false;
    }
    return true;
  } catch (error) {
    deps.log(stage, error);
    return true;
  }
}
