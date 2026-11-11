import { requestCookieSecure } from "@/lib/cookie-security";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { Role } from "@prisma/client";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
export const EMAIL_RESEND_COOLDOWN_MS = 60 * 1000;
export const EMAIL_RESEND_WINDOW_MS = 24 * 60 * 60 * 1000;
export const EMAIL_RESEND_MAX_PER_WINDOW = 5;
export const EMAIL_VERIFICATION_CONTEXT_COOKIE = "bagati_email_verification";
const contextLifetimeSeconds = 24 * 60 * 60;

function secretBytes() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  return new TextEncoder().encode(secret);
}

export function generateVerificationCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function emailVerificationRequired(role: Role, emailVerifiedAt: Date | null) {
  return role !== Role.ADMIN && emailVerifiedAt === null;
}

export function mayUseVendorLogin(role: Role) {
  return role === Role.VENDOR;
}

export function hashVerificationCode(code: string) {
  return createHmac("sha256", secretBytes()).update(`BAGATI_EMAIL_VERIFICATION:${code}`).digest("hex");
}

export function compareVerificationCode(code: string, expectedHash: string) {
  const actual = Buffer.from(hashVerificationCode(code), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function emailResendCooldownSeconds(lastSentAt: Date | null, now: Date) {
  if (!lastSentAt) return 0;
  return Math.max(0, Math.ceil((EMAIL_RESEND_COOLDOWN_MS - (now.getTime() - lastSentAt.getTime())) / 1000));
}

export function emailResendWindowExpired(windowStartedAt: Date | null, now: Date) {
  return !windowStartedAt || now.getTime() - windowStartedAt.getTime() >= EMAIL_RESEND_WINDOW_MS;
}

export function emailCodeCanBeAttempted(expiresAt: Date, attempts: number, now: Date) {
  return expiresAt.getTime() > now.getTime() && attempts < EMAIL_CODE_MAX_ATTEMPTS;
}

export async function createEmailVerificationContext(userId: string, role: Role) {
  return new SignJWT({ purpose: "email-verification", role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("bagati")
    .setAudience("email-verification")
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${contextLifetimeSeconds}s`)
    .sign(secretBytes());
}

export async function attachEmailVerificationContext(response: NextResponse, token: string) {
  const secure = await requestCookieSecure();
  response.cookies.set(EMAIL_VERIFICATION_CONTEXT_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: contextLifetimeSeconds,
  });
}

/** Verification-context tokens are signed HS256 only; any other `alg` header is rejected. */
export async function verifyEmailVerificationContextToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, secretBytes(), {
      algorithms: ["HS256"],
      issuer: "bagati",
      audience: "email-verification",
    });
    if (payload.purpose !== "email-verification" || typeof payload.sub !== "string") return null;
    if (payload.role !== Role.CUSTOMER && payload.role !== Role.VENDOR) return null;
    return { userId: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

export async function readEmailVerificationContext() {
  const token = (await cookies()).get(EMAIL_VERIFICATION_CONTEXT_COOKIE)?.value;
  if (!token) return null;
  return verifyEmailVerificationContextToken(token);
}

export async function clearEmailVerificationContext(response: NextResponse) {
  const secure = await requestCookieSecure();
  response.cookies.delete({
    name: EMAIL_VERIFICATION_CONTEXT_COOKIE,
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
  });
}
