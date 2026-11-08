import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { createSession } from "@/lib/auth";
import { currentUser } from "@/lib/auth";
import { logAuthFailure } from "@/lib/auth-logging";
import { enqueueEmail } from "@/lib/email-outbox";
import { GOOGLE_OAUTH_COOKIE, exchangeGoogleCode, googleOAuthConfig, googleOAuthCookieOptions, safeEqual, safeOAuthNextPath, verifyGoogleOAuthState, type GoogleOAuthIntent, type GoogleOAuthMode } from "@/lib/google-oauth";
import { existingAccountIdentity } from "@/lib/existing-account";
import { createGoogleLinkTransaction, GOOGLE_LINK_COOKIE, GOOGLE_LINK_NEXT_COOKIE, googleLinkCookieOptions, googleLinkDestination, isGoogleLinkableRole, isMissingGoogleLinkStore } from "@/lib/google-link";
import { loginPortalForRole, type LoginPortal } from "@/lib/login-portal";
import { prisma } from "@/lib/prisma";
import { authRateLimitKey, consumeAuthProcessRateLimit, consumeAuthRateLimit, OAUTH_IP_RATE_LIMIT } from "@/lib/auth-rate-limit";
import { trustedCloudflareClientIp } from "@/lib/trusted-proxy";

type CallbackState = { intent: GoogleOAuthIntent; mode: GoogleOAuthMode; next: string; accountUserId?: string };

function entryPath(intent: GoogleOAuthIntent, mode: GoogleOAuthMode) {
  if (mode === "link") return intent === "vendor" ? "/vendor/security" : "/account/security";
  if (intent === "vendor") return mode === "register" ? "/vendor/register" : "/vendor/login";
  return mode === "register" ? "/register" : "/login";
}

function resultUrl(origin: string, state: CallbackState | null, result: string, portal?: LoginPortal) {
  const target = new URL(entryPath(state?.intent ?? "customer", state?.mode ?? "login"), origin);
  target.searchParams.set("oauth", result);
  if (portal && (result === "account-exists" || result === "wrong-role" || result === "link-pending")) target.searchParams.set("portal", portal);
  return target;
}

async function redirectForExistingEmail(origin: string, state: CallbackState, email: string, googleSub: string) {
  const existing = await existingAccountIdentity(email);
  if (existing.kind === "none") return null;
  const portal = existing.kind === "one" ? loginPortalForRole(existing.role) : undefined;
  if (existing.kind === "one" && existing.isActive && isGoogleLinkableRole(existing.role)) {
    try {
      const token = await createGoogleLinkTransaction({ userId: existing.id, googleSub, email });
      const intentMatches = (state.intent === "vendor" && portal === "vendor") || (state.intent === "customer" && portal === "customer");
      const next = intentMatches ? safeOAuthNextPath(state.next, state.intent) : googleLinkDestination(existing.role);
      const response = finish(NextResponse.redirect(new URL("/auth/google/link", origin)));
      response.cookies.set(GOOGLE_LINK_COOKIE, token, googleLinkCookieOptions());
      response.cookies.set(GOOGLE_LINK_NEXT_COOKIE, next, googleLinkCookieOptions());
      return response;
    } catch (error) {
      if (!isMissingGoogleLinkStore(error)) throw error;
      logAuthFailure("google_link_transaction_store", error);
      return finish(NextResponse.redirect(new URL("/auth/google/link?status=unavailable", origin)));
    }
  }
  return finish(NextResponse.redirect(resultUrl(origin, state, "account-exists", portal)));
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
      if (!allowed) return finish(NextResponse.redirect(resultUrl(origin, state, "unavailable")));
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

    let userId = await linkedUserId(identity.sub);
    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true } });
      if (!user?.isActive || user.role !== state.intent.toUpperCase()) {
        return finish(NextResponse.redirect(resultUrl(origin, state, "wrong-role", user?.isActive ? loginPortalForRole(user.role) : undefined)));
      }
      userId = user.id;
    } else {
      const existingRedirect = await redirectForExistingEmail(origin, state, identity.email, identity.sub);
      if (existingRedirect) return existingRedirect;
      if (state.mode === "login") return finish(NextResponse.redirect(resultUrl(origin, state, "not-registered")));

      const displayName = [identity.givenName, identity.familyName].filter(Boolean).join(" ") || identity.name || identity.email.split("@")[0];
      const firstName = identity.givenName || identity.name.split(/\s+/)[0] || "";
      const lastName = identity.familyName || identity.name.split(/\s+/).slice(1).join(" ");
      const passwordHash = await bcrypt.hash(randomBytes(48).toString("base64url"), 12);
      const role = state.intent === "vendor" ? "VENDOR" : "CUSTOMER";
      try {
        const user = await prisma.$transaction(async transaction => {
          const created = await transaction.user.create({
            data: {
              email: identity.email,
              passwordHash,
              passwordAuthEnabled: false,
              role,
              isActive: true,
              emailVerifiedAt: new Date(),
              ...(role === "CUSTOMER"
                ? { customerProfile: { create: { firstName: firstName.slice(0, 80), lastName: lastName.slice(0, 80) } }, cart: { create: {} } }
                : { vendorProfile: { create: { displayName: displayName.slice(0, 120) } } }),
            },
            select: { id: true },
          });
          await transaction.$executeRaw(Prisma.sql`
            INSERT INTO "GoogleAccount" ("id", "googleSub", "userId", "createdAt")
            VALUES (${randomBytes(18).toString("base64url")}, ${identity.sub}, ${created.id}, ${new Date()})
          `);
          await enqueueEmail(transaction, {
            eventKey: `google-welcome:${created.id}`,
            recipient: identity.email,
            template: role === "VENDOR" ? "WELCOME_SELLER" : "WELCOME_CUSTOMER",
            payload: { name: displayName },
          });
          return created;
        });
        userId = user.id;
      } catch (error) {
        const raced = await linkedUserId(identity.sub);
        if (!raced) {
          const conflictRedirect = await redirectForExistingEmail(origin, state, identity.email, identity.sub);
          if (conflictRedirect) return conflictRedirect;
          throw error;
        }
        userId = raced;
      }
    }

    if (!userId) throw new Error("Google OAuth account resolution failed.");
    const account = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true } });
    if (!account?.isActive || account.role !== state.intent.toUpperCase()) {
      return finish(NextResponse.redirect(resultUrl(origin, state, "wrong-role", account?.isActive ? loginPortalForRole(account.role) : undefined)));
    }
    const session = await createSession(userId);
    const destination = safeOAuthNextPath(state.next, state.intent);
    const response = NextResponse.redirect(new URL(destination, origin));
    response.cookies.set(session);
    return finish(response);
  } catch (error) {
    logAuthFailure("google_oauth_callback", error);
    return finish(NextResponse.redirect(resultUrl(origin, state, "failed")));
  }
}
