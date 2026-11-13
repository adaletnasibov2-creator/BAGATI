import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { authRateLimitKey, consumeAuthProcessRateLimit, consumeAuthRateLimit } from "@/lib/auth-rate-limit";
import { csrfRejection } from "@/lib/csrf";
import { captureApplicationSecurityEvent } from "@/lib/security-events";
import { SELLER_APPLICATION_MESSAGES, SELLER_APPLICATION_PROCESS_RATE_LIMIT, SELLER_APPLICATION_RATE_LIMIT } from "@/lib/seller-application";
import type { SellerApplicationError } from "@/lib/seller-application-service";

const headers = { "Cache-Control": "no-store" };
export const applicantJson = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers });

/**
 * Shared guard for the applicant endpoints, in this order: same-origin, a signed-in active CUSTOMER with a
 * verified e-mail (currentUser returns null otherwise), then rate limits. Exceeding a limit is recorded in the
 * Security Center. Returns the user or the response to send.
 */
export async function guardApplicantRequest(request: Request, path: string) {
  const crossSite = csrfRejection(request);
  if (crossSite) return { response: crossSite };
  const user = await currentUser();
  if (!user || user.role !== "CUSTOMER") return { response: applicantJson({ error: SELLER_APPLICATION_MESSAGES.signIn }, user ? 403 : 401) };
  const processAllowed = consumeAuthProcessRateLimit("seller-application", SELLER_APPLICATION_PROCESS_RATE_LIMIT.limit, SELLER_APPLICATION_PROCESS_RATE_LIMIT.windowMs);
  const userAllowed = processAllowed && await consumeAuthRateLimit(authRateLimitKey("seller-application", `user:${user.id}`), SELLER_APPLICATION_RATE_LIMIT.limit, SELLER_APPLICATION_RATE_LIMIT.windowMs);
  if (!userAllowed) {
    await captureApplicationSecurityEvent({ request, eventType: "RATE_LIMIT_VIOLATION", path });
    return { response: applicantJson({ error: SELLER_APPLICATION_MESSAGES.rateLimited }, 429) };
  }
  return { user };
}

export function applicantErrorResponse(error: SellerApplicationError) {
  const nextAllowedAt = typeof error.detail.nextAllowedAt === "string" ? error.detail.nextAllowedAt : undefined;
  switch (error.code) {
    case "OPEN": return applicantJson({ error: SELLER_APPLICATION_MESSAGES.open, code: error.code }, 409);
    case "WAIT": return applicantJson({ error: SELLER_APPLICATION_MESSAGES.wait, code: error.code, nextAllowedAt }, 429);
    case "LIMIT": return applicantJson({ error: SELLER_APPLICATION_MESSAGES.limit, code: error.code, nextAllowedAt }, 429);
    case "NOT_FOUND": return applicantJson({ error: SELLER_APPLICATION_MESSAGES.notFound, code: error.code }, 404);
    case "NOT_PENDING": return applicantJson({ error: SELLER_APPLICATION_MESSAGES.notPending, code: error.code }, 409);
    default: return applicantJson({ error: SELLER_APPLICATION_MESSAGES.accountChanged, code: error.code }, 409);
  }
}
