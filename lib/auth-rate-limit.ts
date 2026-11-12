import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const LOGIN_RATE_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 } as const;
export const PASSWORD_RESET_RATE_LIMIT = { limit: 3, windowMs: 60 * 60 * 1000 } as const;
export const REGISTRATION_RATE_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 } as const;
export const REGISTRATION_IP_RATE_LIMIT = { limit: 30, windowMs: 60 * 60 * 1000 } as const;
export const OAUTH_IP_RATE_LIMIT = { limit: 300, windowMs: 15 * 60 * 1000 } as const;

function authRateLimitSecret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  return value;
}

export function authRateLimitKey(scope: "login" | "password-reset" | "registration" | "google-oauth-start" | "google-oauth-callback" | "store-inquiry", identity: string) {
  return createHmac("sha256", authRateLimitSecret())
    .update(`BAGATI_AUTH_RATE_LIMIT_V1:${scope}:${identity.trim().toLowerCase()}`)
    .digest("hex");
}

const processBuckets = new Map<string, { count: number; reset: number }>();

export function consumeAuthProcessRateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const current = processBuckets.get(key);
  if (!current || current.reset <= now) {
    if (processBuckets.size > 5000) {
      for (const [stored, bucket] of processBuckets) if (bucket.reset <= now) processBuckets.delete(stored);
    }
    processBuckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export async function consumeAuthRateLimit(keyHash: string, limit: number, windowMs: number) {
  const now = new Date();
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "AuthRateLimit" WHERE "expiresAt" < ${now}`);
  const rows = await prisma.$queryRaw<Array<{ attempts: number }>>(Prisma.sql`
    INSERT INTO "AuthRateLimit" ("keyHash", "attempts", "windowStartedAt", "expiresAt", "updatedAt")
    VALUES (${keyHash}, 1, ${now}, ${new Date(now.getTime() + windowMs)}, ${now})
    ON CONFLICT ("keyHash") DO UPDATE SET
      "attempts" = CASE
        WHEN "AuthRateLimit"."windowStartedAt" <= ${new Date(now.getTime() - windowMs)} THEN 1
        ELSE "AuthRateLimit"."attempts" + 1
      END,
      "windowStartedAt" = CASE
        WHEN "AuthRateLimit"."windowStartedAt" <= ${new Date(now.getTime() - windowMs)} THEN ${now}
        ELSE "AuthRateLimit"."windowStartedAt"
      END,
      "expiresAt" = ${new Date(now.getTime() + windowMs)},
      "updatedAt" = ${now}
    RETURNING "attempts"
  `);
  return Number(rows[0]?.attempts ?? limit + 1) <= limit;
}

export async function clearAuthRateLimit(keyHash: string) {
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "AuthRateLimit" WHERE "keyHash" = ${keyHash}`);
}
