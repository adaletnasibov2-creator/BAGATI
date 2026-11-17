/**
 * Production dependencies for lib/admin-email-actions.ts (CSRF, database limiter, audit log). The ADMIN check is
 * written in each route file itself (scripts/role-authorization.test.ts requires that of every admin API).
 */
import { csrfRejection } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { ADMIN_EMAIL_DRAIN_RATE_LIMIT, ADMIN_EMAIL_TEST_RATE_LIMIT, authRateLimitKey, consumeAuthRateLimit } from "@/lib/auth-rate-limit";
import type { AdminEmailActionDependencies } from "@/lib/admin-email-actions";

export const adminEmailActionDependencies: Omit<AdminEmailActionDependencies, "requireAdmin"> = {
  csrfRejection: (request) => csrfRejection(request),
  consumeRateLimit: (action, adminId) => {
    const limit = action === "test" ? ADMIN_EMAIL_TEST_RATE_LIMIT : ADMIN_EMAIL_DRAIN_RATE_LIMIT;
    return consumeAuthRateLimit(authRateLimitKey(action === "test" ? "admin-email-test" : "admin-email-drain", adminId), limit.limit, limit.windowMs);
  },
  audit: async ({ actorId, action, metadata }) => {
    await prisma.auditLog.create({ data: { actorId, action, entityType: "EmailOutbox", entityId: null, metadata } });
  },
};
