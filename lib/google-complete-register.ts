import { NextResponse } from "next/server";
import { csrfRejection } from "@/lib/csrf";
import type { GoogleIdentity } from "@/lib/google-oauth";
import { consumePendingGoogleSignupOnce, expiredPendingGoogleSignupCookie, verifyPendingGoogleSignupToken } from "@/lib/google-pending-signup";

/**
 * Result codes. The client shows the EXISTING texts for them (googleOAuthMessage in components/google-oauth-button.tsx
 * and the register form's consent error); no new text.
 */
export type CompleteGoogleRegisterCode = "terms-required" | "invalid" | "account-exists" | "rate-limited" | "failed";

/** The cookie lib/auth.ts createSession returns (type only: this module never loads the session code itself). */
type SessionCookie = Awaited<ReturnType<typeof import("@/lib/auth").createSession>>;

export type CompleteGoogleRegisterDeps = {
  /** The pending sign-up cookie value from the request. */
  readToken: () => Promise<string | undefined>;
  /** Process + per-IP limits; false = refuse. */
  rateLimitAllowed: () => Promise<boolean>;
  /** True when ANY account has this e-mail or this Google id is already linked. */
  accountExists: (identity: GoogleIdentity) => Promise<boolean>;
  /** The shared creation function (lib/google-customer-account.ts). */
  createAccount: (identity: GoogleIdentity) => Promise<{ id: string }>;
  createSession: (userId: string) => Promise<SessionCookie>;
  consumeOnce?: (id: string, expiresAt: number) => boolean;
  log: (stage: string, error: unknown) => void;
};

function reply(body: Record<string, unknown>, status: number, clearPending: boolean) {
  const response = NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  if (clearPending) response.cookies.set(expiredPendingGoogleSignupCookie());
  return response;
}

const refuse = (code: CompleteGoogleRegisterCode, status: number, clearPending: boolean) => reply({ code }, status, clearPending);

/**
 * POST /api/auth/google/complete-register. Order: same-origin -> rate limit -> acceptTerms === true -> valid cookie
 * -> single use -> no account with this e-mail / Google id -> create (shared function) -> session -> clear cookie.
 *
 * - Without the box ticked nothing happens and the cookie stays, so the person can tick it and press again.
 * - A missing, expired, tampered or already used cookie creates nothing and signs nobody in.
 * - An existing account (any role, ADMIN included) is never signed in or linked from here: the cookie holds no account
 *   id and this route only creates.
 * - The destination is the cookie's next, sanitized again for a customer.
 */
export async function handleCompleteGoogleRegister(request: Request, deps: CompleteGoogleRegisterDeps): Promise<NextResponse> {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;

  let allowed = false;
  try {
    allowed = await deps.rateLimitAllowed();
  } catch (error) {
    deps.log("google_complete_register_rate_limit", error);
    return refuse("failed", 503, false);
  }
  if (!allowed) return refuse("rate-limited", 429, false);

  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  if (!body || typeof body !== "object" || (body as { acceptTerms?: unknown }).acceptTerms !== true) {
    return refuse("terms-required", 400, false);
  }

  const pending = await verifyPendingGoogleSignupToken(await deps.readToken());
  if (!pending) return refuse("invalid", 400, true);
  if (!(deps.consumeOnce ?? consumePendingGoogleSignupOnce)(pending.id, pending.expiresAt)) return refuse("invalid", 400, true);

  try {
    if (await deps.accountExists(pending.identity)) return refuse("account-exists", 409, true);
  } catch (error) {
    deps.log("google_complete_register_lookup", error);
    return refuse("failed", 503, true);
  }

  let userId: string;
  try {
    userId = (await deps.createAccount(pending.identity)).id;
  } catch (error) {
    // A concurrent request may have created the account (unique e-mail / Google id): nothing of ours was written.
    let raced = false;
    try { raced = await deps.accountExists(pending.identity); } catch { /* fall through to "failed" */ }
    if (raced) return refuse("account-exists", 409, true);
    deps.log("google_complete_register_create", error);
    return refuse("failed", 500, true);
  }

  let session: SessionCookie;
  try {
    session = await deps.createSession(userId);
  } catch (error) {
    // The account exists now; the person signs in with Google on /login.
    deps.log("google_complete_register_session", error);
    return refuse("failed", 500, true);
  }
  const response = reply({ redirectTo: pending.next }, 200, true);
  response.cookies.set(session);
  return response;
}
