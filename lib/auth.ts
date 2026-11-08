import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { emailVerificationRequired } from "@/lib/email-verification";
import type { Role } from "@prisma/client";

export const AUTH_SESSION_COOKIE = "bagati_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
function secret() { const value = process.env.SESSION_SECRET; if (!value || value.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters"); return new TextEncoder().encode(value); }
function cookieOptions(maxAge = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
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

function sessionCookie(value: string, maxAge = SESSION_TTL_SECONDS) {
  return { name: AUTH_SESSION_COOKIE, value, ...cookieOptions(maxAge) };
}

/**
 * Creates a new session and revokes the session currently held by this browser.
 * The cookie is returned instead of being written with cookies().set: Next merges
 * that store before response cookies and drops Max-Age=0 when it re-parses Set-Cookie.
 * Callers must set the returned cookie on the Response they actually send.
 */
export async function createSession(userId: string) {
  const cookieStore = await cookies();
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  const token = await new SignJWT({ sub: userId, jti: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("bagati")
    .setAudience("bagati-session")
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret());
  await prisma.authSession.create({ data: { id: sessionId, userId, expiresAt } });
  await revokeCookieSession(cookieStore.get(AUTH_SESSION_COOKIE)?.value);
  return sessionCookie(token);
}

export async function currentUser() {
  const token = (await cookies()).get(AUTH_SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const claims = await readSessionClaims(token);
    if (!claims) return null;
    const session = await prisma.authSession.findUnique({ where: { id: claims.sessionId }, select: { userId: true, expiresAt: true, revokedAt: true } });
    if (!session || session.userId !== claims.userId || session.revokedAt || session.expiresAt <= new Date()) return null;
    const user = await prisma.user.findUnique({
      where: { id: claims.userId, isActive: true },
      select: { id: true, email: true, role: true, emailVerifiedAt: true, customerProfile: { select: { firstName: true, lastName: true } }, vendorProfile: { select: { displayName: true } } },
    });
    if (!user || emailVerificationRequired(user.role, user.emailVerifiedAt)) return null;
    const displayName = user.role === "VENDOR"
      ? user.vendorProfile?.displayName
      : [user.customerProfile?.firstName, user.customerProfile?.lastName].filter(Boolean).join(" ");
    return { id: user.id, email: user.email, role: user.role, displayName: displayName || user.email };
  } catch { return null; }
}
export async function requireRole(...roles: Role[]) { const user = await currentUser(); if (!user || !roles.includes(user.role)) return null; return user; }
export async function requireStoreAccess(storeId: string) { const user = await currentUser(); if (!user || user.role !== "VENDOR") return null; const owned = await prisma.store.findFirst({ where: { id: storeId, vendor: { userId: user.id } }, select: { id: true } }); return owned ? { user, storeId: owned.id } : null; }
export function expiredSessionCookie() {
  return sessionCookie("", 0);
}

/** Revokes the database session only. The route expires bagati_session on its Response. */
export async function destroySession() {
  const cookieStore = await cookies();
  await revokeCookieSession(cookieStore.get(AUTH_SESSION_COOKIE)?.value);
}
