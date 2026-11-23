import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { createSession } from "@/lib/auth";
import { logAuthFailure } from "@/lib/auth-logging";
import { authRateLimitKey, consumeAuthProcessRateLimit, consumeAuthRateLimit, OAUTH_IP_RATE_LIMIT } from "@/lib/auth-rate-limit";
import { existingAccountIdentity } from "@/lib/existing-account";
import { handleCompleteGoogleRegister } from "@/lib/google-complete-register";
import { createGoogleCustomerAccount } from "@/lib/google-customer-account";
import { GOOGLE_PENDING_SIGNUP_COOKIE } from "@/lib/google-pending-signup";
import { prisma } from "@/lib/prisma";
import { trustedCloudflareClientIp } from "@/lib/trusted-proxy";

/** SIGNUP-EASY-2: one-click finish of a Google sign-up that started on /login. Rules: lib/google-complete-register.ts. */
export async function POST(request: NextRequest) {
  return handleCompleteGoogleRegister(request, {
    readToken: async () => request.cookies.get(GOOGLE_PENDING_SIGNUP_COOKIE)?.value,
    rateLimitAllowed: async () => {
      if (!consumeAuthProcessRateLimit("google-complete-register", 120, 60_000)) return false;
      const clientIp = trustedCloudflareClientIp(request.headers);
      if (!clientIp) return true;
      return consumeAuthRateLimit(authRateLimitKey("google-complete-register", `ip:${clientIp}`), OAUTH_IP_RATE_LIMIT.limit, OAUTH_IP_RATE_LIMIT.windowMs);
    },
    accountExists: async identity => {
      if ((await existingAccountIdentity(identity.email)).kind !== "none") return true;
      const linked = await prisma.$queryRaw<Array<{ userId: string }>>(Prisma.sql`
        SELECT "userId" FROM "GoogleAccount" WHERE "googleSub" = ${identity.sub} LIMIT 1
      `);
      return linked.length > 0;
    },
    createAccount: identity => createGoogleCustomerAccount(prisma, identity),
    createSession: userId => createSession(userId),
    log: logAuthFailure,
  });
}
