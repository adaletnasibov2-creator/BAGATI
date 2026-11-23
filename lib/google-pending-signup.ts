import { createHmac, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { safeOAuthNextPath, type GoogleIdentity } from "@/lib/google-oauth";

/**
 * SIGNUP-EASY-2: a NEW customer signs in with Google on /login. Instead of a second Google trip, the callback stores
 * the verified Google identity in this short-lived, signed, HttpOnly cookie and sends the person to /register, where
 * ticking the consent box and pressing one button creates the account (POST /api/auth/google/complete-register).
 *
 * - Signed HS256 with its own key (derived from SESSION_SECRET for this purpose only), issuer "bagati", audience
 *   "google-pending-signup", purpose "google-pending-signup": a session, OAuth-state or e-mail-verification token
 *   never passes as this one, and this one never passes as them.
 * - 10 minutes (token exp and cookie Max-Age). HttpOnly (never readable by page JavaScript), SameSite=Lax, Secure
 *   in production like the other OAuth cookies.
 * - Issued only for an identity whose e-mail Google verified (email_verified === true, claim checked again on read).
 * - Holds no account id: it can only CREATE a new customer account, never sign in to an existing one.
 */
export const GOOGLE_PENDING_SIGNUP_COOKIE = "bagati_google_signup";
export const GOOGLE_PENDING_SIGNUP_MAX_AGE = 10 * 60;
const AUDIENCE = "google-pending-signup";
const PURPOSE = "google-pending-signup";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type PendingGoogleSignup = {
  /** Unique per cookie; marks the cookie as used (single use). */
  id: string;
  identity: GoogleIdentity;
  /** Already sanitized for a customer (safeOAuthNextPath). */
  next: string;
  expiresAt: number;
};

function pendingSignupKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  return createHmac("sha256", secret).update("BAGATI_GOOGLE_PENDING_SIGNUP_V1").digest();
}

const shortText = (value: unknown) => typeof value === "string" && value.length <= 80;

/** Signs the cookie value. Refuses an identity whose e-mail Google did not verify. */
export async function createPendingGoogleSignupToken(identity: GoogleIdentity & { emailVerified: boolean }, next: string) {
  if (identity.emailVerified !== true) throw new Error("A pending Google sign-up needs a Google-verified e-mail.");
  return new SignJWT({
    purpose: PURPOSE,
    email: identity.email,
    email_verified: true,
    given_name: identity.givenName,
    family_name: identity.familyName,
    name: identity.name,
    next: safeOAuthNextPath(next, "customer"),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("bagati")
    .setAudience(AUDIENCE)
    .setSubject(identity.sub)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${GOOGLE_PENDING_SIGNUP_MAX_AGE}s`)
    .sign(pendingSignupKey());
}

/** HS256 only, this key, issuer, audience and purpose; any missing, expired, tampered or malformed token gives null. */
export async function verifyPendingGoogleSignupToken(token: string | undefined | null): Promise<PendingGoogleSignup | null> {
  if (!token || token.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(token, pendingSignupKey(), { algorithms: ["HS256"], issuer: "bagati", audience: AUDIENCE });
    if (
      payload.purpose !== PURPOSE
      || payload.email_verified !== true
      || typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255
      || typeof payload.jti !== "string" || !payload.jti
      || typeof payload.exp !== "number"
      || typeof payload.email !== "string" || payload.email.length > 254 || payload.email !== payload.email.trim().toLowerCase() || !EMAIL_PATTERN.test(payload.email)
      || !shortText(payload.given_name) || !shortText(payload.family_name) || !shortText(payload.name)
      || typeof payload.next !== "string"
    ) return null;
    return {
      id: payload.jti,
      identity: {
        sub: payload.sub,
        email: payload.email,
        givenName: payload.given_name as string,
        familyName: payload.family_name as string,
        name: payload.name as string,
      },
      next: safeOAuthNextPath(payload.next, "customer"),
      expiresAt: payload.exp * 1000,
    };
  } catch {
    return null;
  }
}

export function pendingGoogleSignupCookieOptions(maxAge = GOOGLE_PENDING_SIGNUP_MAX_AGE) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
    ...(maxAge <= 0 ? { expires: new Date(0) } : {}),
  };
}

export function expiredPendingGoogleSignupCookie() {
  return { name: GOOGLE_PENDING_SIGNUP_COOKIE, value: "", ...pendingGoogleSignupCookieOptions(0) };
}

/** /register (server page): the waiting identity, or null; an invalid or expired cookie is simply ignored here. */
export async function readPendingGoogleSignup() {
  return verifyPendingGoogleSignupToken((await cookies()).get(GOOGLE_PENDING_SIGNUP_COOKIE)?.value);
}

/**
 * Single use inside this process: a cookie id is accepted once. The database re-check in the completion handler
 * (no account with this e-mail or Google id may exist) makes a second use fail across processes too.
 */
const usedPendingSignups = new Map<string, number>();
export function consumePendingGoogleSignupOnce(id: string, expiresAt: number, now = Date.now()) {
  for (const [key, expiry] of usedPendingSignups) if (expiry <= now) usedPendingSignups.delete(key);
  if (usedPendingSignups.has(id)) return false;
  if (usedPendingSignups.size >= 10_000) return false;
  usedPendingSignups.set(id, Math.max(expiresAt, now));
  return true;
}
