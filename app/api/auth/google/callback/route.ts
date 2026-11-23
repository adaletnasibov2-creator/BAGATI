import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { createSession } from "@/lib/auth";
import { currentUser } from "@/lib/auth";
import { logAuthFailure } from "@/lib/auth-logging";
import { GOOGLE_OAUTH_COOKIE, GoogleEmailUnverifiedError, type GoogleIdentity, exchangeGoogleCode, googleOAuthConfig, googleOAuthCookieOptions, safeEqual, safeOAuthNextPath, verifyGoogleOAuthState, type GoogleOAuthIntent, type GoogleOAuthMode } from "@/lib/google-oauth";
import { decideGoogleSignIn, intentRole, stateAcceptedCustomerTerms, type GoogleSignInDecision } from "@/lib/google-oauth-decision";
import { createGoogleCustomerAccount } from "@/lib/google-customer-account";
import { createPendingGoogleSignupToken, GOOGLE_PENDING_SIGNUP_COOKIE, pendingGoogleSignupCookieOptions } from "@/lib/google-pending-signup";
import { existingAccountIdentity } from "@/lib/existing-account";
import { createGoogleLinkTransaction, GOOGLE_LINK_COOKIE, GOOGLE_LINK_NEXT_COOKIE, googleLinkCookieOptions, isMissingGoogleLinkStore } from "@/lib/google-link";
import { loginPortalForRole, type LoginPortal } from "@/lib/login-portal";
import { prisma } from "@/lib/prisma";
import { authRateLimitKey, consumeAuthProcessRateLimit, consumeAuthRateLimit, OAUTH_IP_RATE_LIMIT } from "@/lib/auth-rate-limit";
import { trustedCloudflareClientIp } from "@/lib/trusted-proxy";

type CallbackState = { intent: GoogleOAuthIntent; mode: GoogleOAuthMode; next: string; accountUserId?: string };

function entryPath(intent: GoogleOAuthIntent, mode: GoogleOAuthMode) {
  if (mode === "link") return intent === "vendor" ? "/vendor/security" : "/account/security";
  // Seller self-registration is closed, so every seller result lands on the seller login page.
  if (intent === "vendor") return "/vendor/login";
  return mode === "register" ? "/register" : "/login";
}

/** Results that always send the customer to /register, whichever page started the flow (decision 1a). */
const REGISTER_RESULTS = new Set(["register-required", "terms-required"]);

function resultUrl(origin: string, state: CallbackState | null, result: string, portal?: LoginPortal) {
  const path = REGISTER_RESULTS.has(result) ? "/register" : entryPath(state?.intent ?? "customer", state?.mode ?? "login");
  const target = new URL(path, origin);
  target.searchParams.set("oauth", result);
  if (portal && (result === "account-exists" || result === "wrong-role" || result === "link-pending")) target.searchParams.set("portal", portal);
  // Keep the customer's destination (e.g. /checkout, /vendor/apply) across an error on the login/register page.
  if (state && state.intent === "customer" && state.mode !== "link" && state.next !== "/account") target.searchParams.set("next", state.next);
  return target;
}

/** Starts the password-confirmed link for a same-role account. The browser never supplies the account id. */
async function redirectToPasswordLink(origin: string, state: CallbackState, userId: string, email: string, googleSub: string) {
  try {
    const token = await createGoogleLinkTransaction({ userId, googleSub, email });
    const response = finish(NextResponse.redirect(new URL("/auth/google/link", origin)));
    response.cookies.set(GOOGLE_LINK_COOKIE, token, googleLinkCookieOptions());
    response.cookies.set(GOOGLE_LINK_NEXT_COOKIE, safeOAuthNextPath(state.next, state.intent), googleLinkCookieOptions());
    return response;
  } catch (error) {
    if (!isMissingGoogleLinkStore(error)) throw error;
    logAuthFailure("google_link_transaction_store", error);
    return finish(NextResponse.redirect(new URL("/auth/google/link?status=unavailable", origin)));
  }
}

/**
 * SIGNUP-EASY-2: /register with the verified identity in the signed pending sign-up cookie (lib/google-pending-signup.ts).
 * exchangeGoogleCode returns only identities whose e-mail Google verified (email_verified === true). Null when the
 * cookie cannot be made; the caller then falls back to /register?oauth=register-required.
 */
async function pendingSignupRedirect(origin: string, state: CallbackState, identity: GoogleIdentity) {
  try {
    const token = await createPendingGoogleSignupToken({ ...identity, emailVerified: true }, state.next);
    const target = new URL("/register", origin);
    const next = safeOAuthNextPath(state.next, "customer");
    if (next !== "/account") target.searchParams.set("next", next);
    const response = finish(NextResponse.redirect(target));
    response.cookies.set(GOOGLE_PENDING_SIGNUP_COOKIE, token, pendingGoogleSignupCookieOptions());
    return response;
  } catch (error) {
    logAuthFailure("google_pending_signup_cookie", error);
    return null;
  }
}

function finish(response: NextResponse) {
  response.cookies.set(GOOGLE_OAUTH_COOKIE, "", { ...googleOAuthCookieOptions(), maxAge: 0, expires: new Date(0) });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

async function linkedUserId(googleSub: string) {
  const rows = await prisma.$queryRaw<Array<{ userId: string }>>(Prisma.sql`
    SELECT "userId" FROM "GoogleAccount" WHERE "googleSub" = ${googleSub} LIMIT 1
  `);
  return rows[0]?.userId ?? null;
}

export async function GET(request: NextRequest) {
  // Error redirects stay on this deployment: the canonical production origin in production, the local origin elsewhere.
  let origin = process.env.NODE_ENV === "production" ? "https://shopbagati.com" : request.nextUrl.origin;
  try { origin = googleOAuthConfig(request.url, request.headers.get("host")).origin; } catch { /* Fall back to the safe default above. */ }
  const rawState = request.cookies.get(GOOGLE_OAUTH_COOKIE)?.value;
  const state = rawState ? await verifyGoogleOAuthState(rawState) : null;
  if (!consumeAuthProcessRateLimit("google-oauth-callback", 600, 60_000)) {
    return finish(NextResponse.redirect(resultUrl(origin, state, "unavailable")));
  }
  const returnedState = request.nextUrl.searchParams.get("state") ?? "";
  if (!state || !safeEqual(state.state, returnedState)) {
    return finish(NextResponse.redirect(resultUrl(origin, state, "invalid")));
  }
  const returnedError = request.nextUrl.searchParams.get("error");
  if (returnedError) {
    return finish(NextResponse.redirect(resultUrl(origin, state, returnedError === "access_denied" ? "cancelled" : "failed")));
  }
  const code = request.nextUrl.searchParams.get("code");
  if (!code || code.length > 4096) return finish(NextResponse.redirect(resultUrl(origin, state, "invalid")));

  const clientIp = trustedCloudflareClientIp(request.headers);
  if (clientIp) {
    try {
      const allowed = await consumeAuthRateLimit(
        authRateLimitKey("google-oauth-callback", `ip:${clientIp}`),
        OAUTH_IP_RATE_LIMIT.limit,
        OAUTH_IP_RATE_LIMIT.windowMs,
      );
      if (!allowed) return finish(NextResponse.redirect(resultUrl(origin, state, "rate-limited"))); // SIGNUP-EASY-1 R7
    } catch (error) {
      logAuthFailure("google_oauth_callback_rate_limit", error);
      return finish(NextResponse.redirect(resultUrl(origin, state, "unavailable")));
    }
  }

  try {
    const config = googleOAuthConfig(request.url, request.headers.get("host"));
    const { identity, nonce } = await exchangeGoogleCode(code, state.verifier, config);
    if (!safeEqual(state.nonce, nonce)) return finish(NextResponse.redirect(resultUrl(origin, state, "invalid")));

    if (state.mode === "link") {
      const account = await currentUser();
      if (!account || account.id !== state.accountUserId || account.role !== state.intent.toUpperCase()) {
        return finish(NextResponse.redirect(resultUrl(origin, state, "link-auth-required")));
      }
      if (account.email.trim().toLowerCase() !== identity.email) {
        return finish(NextResponse.redirect(resultUrl(origin, state, "link-email-mismatch")));
      }

      const linkedAccountUserId = await linkedUserId(identity.sub);
      if (linkedAccountUserId && linkedAccountUserId !== account.id) {
        return finish(NextResponse.redirect(resultUrl(origin, state, "link-conflict")));
      }
      if (linkedAccountUserId === account.id) {
        return finish(NextResponse.redirect(resultUrl(origin, state, "linked")));
      }
      const existingGoogleAccount = await prisma.googleAccount.findUnique({
        where: { userId: account.id },
        select: { googleSub: true },
      });
      if (existingGoogleAccount) {
        return finish(NextResponse.redirect(resultUrl(origin, state, "link-conflict")));
      }

      try {
        await prisma.googleAccount.create({ data: { googleSub: identity.sub, userId: account.id } });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
        const [racedUserId, racedGoogleAccount] = await Promise.all([
          linkedUserId(identity.sub),
          prisma.googleAccount.findUnique({ where: { userId: account.id }, select: { googleSub: true } }),
        ]);
        const result = racedUserId === account.id && racedGoogleAccount?.googleSub === identity.sub ? "linked" : "link-conflict";
        return finish(NextResponse.redirect(resultUrl(origin, state, result)));
      }
      return finish(NextResponse.redirect(resultUrl(origin, state, "linked")));
    }

    const resolve = async (): Promise<GoogleSignInDecision> => {
      const linkedId = await linkedUserId(identity.sub);
      const linkedUser = linkedId ? await prisma.user.findUnique({ where: { id: linkedId }, select: { id: true, role: true, isActive: true } }) : null;
      // A dangling GoogleAccount row without a user is treated as unlinked; the unique index still guards creation.
      return decideGoogleSignIn({
        intent: state.intent,
        linkedUser,
        existing: linkedUser ? { kind: "none" } : await existingAccountIdentity(identity.email),
        customerTermsAccepted: stateAcceptedCustomerTerms(state),
      });
    };

    let decision = await resolve();
    if (decision.kind === "create-customer") {
      // Only reachable with intent=customer (see decideGoogleSignIn); the role is fixed in the shared function, never taken from state.
      try {
        const user = await createGoogleCustomerAccount(prisma, identity);
        decision = { kind: "session", userId: user.id };
      } catch (error) {
        // A concurrent sign-in may have created the account or link; decide again from the database.
        decision = await resolve();
        if (decision.kind === "create-customer") throw error;
      }
    }

    // SIGNUP-EASY-2: a new customer from /login. The verified identity waits in a signed 10-minute cookie and /register
    // finishes the sign-up with the consent box and one button (no second Google trip). If the cookie cannot be made,
    // the old /register?oauth=register-required message is the fallback.
    if (decision.kind === "redirect" && decision.result === "register-required") {
      const pending = await pendingSignupRedirect(origin, state, identity);
      if (pending) return pending;
    }
    if (decision.kind === "link") return redirectToPasswordLink(origin, state, decision.userId, identity.email, identity.sub);
    if (decision.kind === "redirect") return finish(NextResponse.redirect(resultUrl(origin, state, decision.result, decision.portal)));
    if (decision.kind !== "session") throw new Error("Google OAuth account resolution failed.");

    const userId = decision.userId;
    const account = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true } });
    if (!account?.isActive) return finish(NextResponse.redirect(resultUrl(origin, state, "account-inactive")));
    if (account.role !== intentRole(state.intent)) {
      return finish(NextResponse.redirect(resultUrl(origin, state, "wrong-role", loginPortalForRole(account.role))));
    }
    const session = await createSession(userId);
    const destination = safeOAuthNextPath(state.next, state.intent);
    const response = NextResponse.redirect(new URL(destination, origin));
    response.cookies.set(session);
    return finish(response);
  } catch (error) {
    if (error instanceof GoogleEmailUnverifiedError) return finish(NextResponse.redirect(resultUrl(origin, state, "email-unverified")));
    logAuthFailure("google_oauth_callback", error);
    return finish(NextResponse.redirect(resultUrl(origin, state, "failed")));
  }
}
