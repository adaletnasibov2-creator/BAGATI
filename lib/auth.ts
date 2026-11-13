import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { emailVerificationRequired } from "@/lib/email-verification";
import { requestCookieSecure } from "@/lib/cookie-security";
import { trustedCloudflareClientIp } from "@/lib/trusted-proxy";
import { maskIpAddress } from "@/lib/admin-system-status";
import { adminMayUseSession, isAdmin2faRequired } from "@/lib/admin-2fa-policy";
import { isSessionIdleExpired, sessionTtlSeconds, shouldWriteLastSeen, summarizeUserAgent, tracksSessionActivity } from "@/lib/session-policy";
import type { Role } from "@prisma/client";

export const AUTH_SESSION_COOKIE = "bagati_session";
/** Longest session lifetime (non-admin roles). Admin sessions use ADMIN_SESSION_TTL_SECONDS (12 hours). */
const SESSION_TTL_SECONDS = sessionTtlSeconds("CUSTOMER");
function secret() { const value = process.env.SESSION_SECRET; if (!value || value.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters"); return new TextEncoder().encode(value); }
function cookieOptions(maxAge = SESSION_TTL_SECONDS, secure = process.env.NODE_ENV === "production") {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
    // Max-Age=0 is dropped when Next re-parses Set-Cookie. A past Expires still deletes the cookie.
    ...(maxAge <= 0 ? { expires: new Date(0) } : {}),
  };
}

/** Session cookies are signed HS256 only; any other `alg` header is rejected before claims are read. */
export async function readSessionClaims(token: string) {
  const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"], issuer: "bagati", audience: "bagati-session" });
  if (typeof payload.sub !== "string" || typeof payload.jti !== "string") return null;
  return { userId: payload.sub, sessionId: payload.jti };
}

async function revokeCookieSession(token?: string) {
  if (!token) return;
  let claims: Awaited<ReturnType<typeof readSessionClaims>> = null;
  try {
    claims = await readSessionClaims(token);
  } catch { /* Invalid/expired cookies are still cleared during login and logout. */ }
  if (claims) await prisma.authSession.updateMany({ where: { id: claims.sessionId, userId: claims.userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

function sessionCookie(value: string, maxAge = SESSION_TTL_SECONDS, secure?: boolean) {
  return { name: AUTH_SESSION_COOKIE, value, ...cookieOptions(maxAge, secure) };
}

/** Masked IP and short browser summary for the admin session list. Never the full IP or User-Agent. */
async function sessionClientMetadata() {
  try {
    const list = await headers();
    const ip = trustedCloudflareClientIp(list);
    return { ipMasked: ip ? maskIpAddress(ip) : null, userAgent: summarizeUserAgent(list.get("user-agent")) };
  } catch {
    return { ipMasked: null, userAgent: null };
  }
}

/**
 * Creates a new session and revokes the session currently held by this browser.
 * The cookie is returned instead of being written with cookies().set: Next merges
 * that store before response cookies and drops Max-Age=0 when it re-parses Set-Cookie.
 * Callers must set the returned cookie on the Response they actually send.
 * Lifetime depends on the role: 12 hours for ADMIN, 7 days otherwise.
 */
export async function createSession(userId: string) {
  const cookieStore = await cookies();
  const account = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  const role: Role = account?.role ?? "CUSTOMER";
  const ttlSeconds = sessionTtlSeconds(role);
  const sessionId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  const token = await new SignJWT({ sub: userId, jti: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("bagati")
    .setAudience("bagati-session")
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret());
  const activity = tracksSessionActivity(role) ? { lastSeenAt: now, ...(await sessionClientMetadata()) } : {};
  await prisma.authSession.create({ data: { id: sessionId, userId, expiresAt, ...activity } });
  await revokeCookieSession(cookieStore.get(AUTH_SESSION_COOKIE)?.value);
  return sessionCookie(token, ttlSeconds, await requestCookieSecure());
}

export async function currentUser() {
  const token = (await cookies()).get(AUTH_SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const claims = await readSessionClaims(token);
    if (!claims) return null;
    const session = await prisma.authSession.findUnique({ where: { id: claims.sessionId }, select: { userId: true, expiresAt: true, revokedAt: true, createdAt: true, lastSeenAt: true } });
    const now = new Date();
    if (!session || session.userId !== claims.userId || session.revokedAt || session.expiresAt <= new Date()) return null;
    const user = await prisma.user.findUnique({
      where: { id: claims.userId, isActive: true },
      select: { id: true, email: true, role: true, emailVerifiedAt: true, customerProfile: { select: { firstName: true, lastName: true } }, vendorProfile: { select: { displayName: true } }, adminTwoFactor: { select: { enrolledAt: true } } },
    });
    if (!user || emailVerificationRequired(user.role, user.emailVerifiedAt)) return null;
    if (user.role === "ADMIN") {
      if (isSessionIdleExpired({ role: user.role, lastSeenAt: session.lastSeenAt, createdAt: session.createdAt, now })) {
        await prisma.authSession.updateMany({ where: { id: claims.sessionId, revokedAt: null }, data: { revokedAt: now } });
        return null;
      }
      // With BAGATI_ADMIN_2FA_REQUIRED=true an admin without 2FA cannot use any admin page or API, even with an older session.
      if (!adminMayUseSession({ required: isAdmin2faRequired(), enrolled: Boolean(user.adminTwoFactor?.enrolledAt) })) return null;
      if (shouldWriteLastSeen(session.lastSeenAt, now)) {
        await prisma.authSession.updateMany({ where: { id: claims.sessionId, revokedAt: null }, data: { lastSeenAt: now } });
      }
    }
    const displayName = user.role === "VENDOR"
      ? user.vendorProfile?.displayName
      : [user.customerProfile?.firstName, user.customerProfile?.lastName].filter(Boolean).join(" ");
    return { id: user.id, email: user.email, role: user.role, displayName: displayName || user.email };
  } catch { return null; }
}
export async function requireRole(...roles: Role[]) { const user = await currentUser(); if (!user || !roles.includes(user.role)) return null; return user; }
export async function requireStoreAccess(storeId: string) { const user = await currentUser(); if (!user || user.role !== "VENDOR") return null; const owned = await prisma.store.findFirst({ where: { id: storeId, vendor: { userId: user.id } }, select: { id: true } }); return owned ? { user, storeId: owned.id } : null; }
/** `secure` must match how the cookie was set, or browsers on plain-HTTP LAN pages refuse the deletion. */
export function expiredSessionCookie(secure?: boolean) {
  return sessionCookie("", 0, secure);
}

/** Id of the session this request is authenticated with, or null. Used to mark and protect the current session. */
export async function currentSessionId(): Promise<string | null> {
  const token = (await cookies()).get(AUTH_SESSION_COOKIE)?.value;
  if (!token) return null;
  try { return (await readSessionClaims(token))?.sessionId ?? null; } catch { return null; }
}

/** Revokes every active session of the user except `keepSessionId` (null revokes all). Returns the number revoked. */
export async function revokeUserSessions(userId: string, keepSessionId: string | null) {
  const result = await prisma.authSession.updateMany({
    where: { userId, revokedAt: null, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** Revokes the database session only. The route expires bagati_session on its Response. */
export async function destroySession() {
  const cookieStore = await cookies();
  await revokeCookieSession(cookieStore.get(AUTH_SESSION_COOKIE)?.value);
}
