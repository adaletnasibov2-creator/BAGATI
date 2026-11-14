/**
 * Per-IP limits on the admin entry point (password step and 2FA code step), in addition to the per-account limits.
 *
 * - Known client IP (trusted Cloudflare header, see lib/trusted-proxy.ts): one bucket per IP.
 * - Unknown client IP (flag off, header missing/invalid, or CF-Connecting-IP ≠ X-Real-IP): every such request shares
 *   ONE global bucket with a stricter limit, so a missing header cannot be used to escape the per-IP limit.
 *
 * All limits are fixed windows (lib/auth-rate-limit.ts): after the window the bucket starts again from zero, so the
 * real admin can never be locked out permanently. Pure module: keys and messages only, no database access.
 */
import { authRateLimitKey } from "@/lib/auth-rate-limit";
import { trustedCloudflareClientIp } from "@/lib/trusted-proxy";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/** Admin password attempts per client IP. */
export const ADMIN_LOGIN_IP_RATE_LIMIT = { limit: 20, windowMs: FIFTEEN_MINUTES } as const;
/** Admin password attempts from all requests whose client IP is unknown, together (stricter than per IP). */
export const ADMIN_LOGIN_UNKNOWN_IP_RATE_LIMIT = { limit: 10, windowMs: FIFTEEN_MINUTES } as const;
/** Admin 2FA code attempts from all requests whose client IP is unknown, together (per IP: ADMIN_2FA_IP_RATE_LIMIT). */
export const ADMIN_2FA_UNKNOWN_IP_RATE_LIMIT = { limit: 15, windowMs: FIFTEEN_MINUTES } as const;

export type IpRateLimitBucket = { key: string; limit: number; windowMs: number; scope: "ip" | "unknown-ip" };

/** Bucket for an admin password attempt: per client IP, or the shared stricter bucket when the IP is unknown. */
export function adminLoginIpBucket(headers: Headers, trustedProxy?: boolean): IpRateLimitBucket {
  const ip = trustedCloudflareClientIp(headers, trustedProxy);
  if (ip) return { key: authRateLimitKey("admin-login", `ip:${ip}`), ...ADMIN_LOGIN_IP_RATE_LIMIT, scope: "ip" };
  return { key: authRateLimitKey("admin-login", "ip-unknown:global"), ...ADMIN_LOGIN_UNKNOWN_IP_RATE_LIMIT, scope: "unknown-ip" };
}

/** Bucket for an admin 2FA code attempt (same rule; the per-IP limit is passed in from the 2FA policy). */
export function admin2faIpBucket(headers: Headers, perIp: { limit: number; windowMs: number }, trustedProxy?: boolean): IpRateLimitBucket {
  const ip = trustedCloudflareClientIp(headers, trustedProxy);
  if (ip) return { key: authRateLimitKey("admin-2fa", `ip:${ip}`), limit: perIp.limit, windowMs: perIp.windowMs, scope: "ip" };
  return { key: authRateLimitKey("admin-2fa", "ip-unknown:global"), ...ADMIN_2FA_UNKNOWN_IP_RATE_LIMIT, scope: "unknown-ip" };
}

/** Azerbaijani 429 message naming the wait (the window), and the matching Retry-After seconds. */
export function adminRateLimitedResponseParts(windowMs: number) {
  const minutes = Math.max(1, Math.ceil(windowMs / 60_000));
  return {
    error: `Çox sayda giriş cəhdi edildi. ${minutes} dəqiqə sonra yenidən yoxlayın.`,
    retryAfterSeconds: String(Math.ceil(windowMs / 1000)),
  };
}
