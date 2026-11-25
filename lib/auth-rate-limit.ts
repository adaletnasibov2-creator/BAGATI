import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const LOGIN_RATE_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 } as const;
export const PASSWORD_RESET_RATE_LIMIT = { limit: 3, windowMs: 60 * 60 * 1000 } as const;
export const REGISTRATION_RATE_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 } as const;
export const REGISTRATION_IP_RATE_LIMIT = { limit: 30, windowMs: 60 * 60 * 1000 } as const;
export const OAUTH_IP_RATE_LIMIT = { limit: 300, windowMs: 15 * 60 * 1000 } as const;
/** Admin email tools, per admin account. */
export const ADMIN_EMAIL_TEST_RATE_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 } as const;
export const ADMIN_EMAIL_DRAIN_RATE_LIMIT = { limit: 10, windowMs: 10 * 60 * 1000 } as const;

function authRateLimitSecret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  return value;
}

/** Current-password checks by a signed-in user (password change, admin 2FA enroll/disable), per user (SEC-FIX-1 L3). */
export const PASSWORD_CHECK_RATE_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 } as const;

export function authRateLimitKey(scope: "login" | "vendor-login" | "admin-login-account" | "password-check" | "password-reset" | "registration" | "google-oauth-start" | "google-oauth-callback" | "google-complete-register" | "support" | "epoint-reconcile" | "shipment-email" | "store-inquiry" | "order-receipt" | "store-notification-email" | "admin-2fa" | "admin-email-test" | "admin-email-drain" | "admin-login" | "messaging" | "seller-application", identity: string) {
  return createHmac("sha256", authRateLimitSecret())
    .update(`BAGATI_AUTH_RATE_LIMIT_V1:${scope}:${identity.trim().toLowerCase()}`)
    .digest("hex");
}

export type LoginRateLimitPortal = "customer" | "vendor" | "admin";

/**
 * Per-account login lock (LOGIN_RATE_LIMIT), separate for each login page (SEC-FIX-1 M6): wrong passwords sent to the
 * customer login can no longer lock the same email out of the seller or admin login. The customer key is the old
 * "login" key, so existing customer buckets keep counting.
 */
export function loginRateLimitKey(portal: LoginRateLimitPortal, email: string) {
  const scope = portal === "customer" ? "login" : portal === "vendor" ? "vendor-login" : "admin-login-account";
  return authRateLimitKey(scope, email);
}

/** Key for PASSWORD_CHECK_RATE_LIMIT: one bucket per user and purpose. */
export function passwordCheckRateLimitKey(purpose: "password-change" | "admin-2fa-disable" | "admin-2fa-enroll", userId: string) {
  return authRateLimitKey("password-check", `${purpose}:${userId}`);
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
