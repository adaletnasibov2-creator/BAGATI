/**
 * ADMIN-POWER-1: in-process budget for the admin search and list-export routes (the public-search pattern,
 * lib/public-search-rate-limit.ts): per admin account and, when the client IP is trusted, per IP. No database read or
 * write; the raw IP lives only in this process's memory.
 */
import { consumeAuthProcessRateLimit } from "@/lib/auth-rate-limit";
import { trustedCloudflareClientIp } from "@/lib/trusted-proxy";

type ProcessLimiter = (key: string, limit: number, windowMs: number) => boolean;

export function allowAdminRequest(scope: "admin-search" | "admin-list-export", adminId: string, headers: Headers, budget: { limit: number; windowMs: number }, consume: ProcessLimiter = consumeAuthProcessRateLimit): boolean {
  if (!consume(`${scope}:admin:${adminId}`, budget.limit, budget.windowMs)) return false;
  const ip = trustedCloudflareClientIp(headers);
  return !ip || consume(`${scope}:ip:${ip}`, budget.limit, budget.windowMs);
}
