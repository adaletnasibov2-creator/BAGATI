/**
 * Admin TOTP second factor: challenge tokens, enrollment, verification with lockout and rate limits, disable.
 *
 * No admin session exists between the password step and a valid second factor: the password step only sets a
 * short-lived signed challenge cookie (scoped to /api/admin) that cannot be used as a session.
 */
import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { requestCookieSecure } from "@/lib/cookie-security";
import { admin2faIpBucket } from "@/lib/admin-login-rate-limit";
import { authRateLimitKey, consumeAuthRateLimit } from "@/lib/auth-rate-limit";
import { captureApplicationSecurityEvent } from "@/lib/security-events";
import { admin2faKeyStatus, Admin2faKeyError, decryptTotpSecret, encryptTotpSecret } from "@/lib/admin-2fa-crypto";
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode, verifyRecoveryCode } from "@/lib/admin-recovery-codes";
import { formatManualKey, generateTotpSecret, otpauthUri, verifyTotp } from "@/lib/totp";
import { qrSvg } from "@/lib/qr-code";
import {
  ADMIN_2FA_CHALLENGE_SECONDS, ADMIN_2FA_ENROLL_CHALLENGE_SECONDS, ADMIN_2FA_IP_RATE_LIMIT, ADMIN_2FA_USER_RATE_LIMIT,
  afterFailedSecondFactor, isAdmin2faRequired, isSecondFactorLocked,
} from "@/lib/admin-2fa-policy";

export const ADMIN_2FA_CHALLENGE_COOKIE = "bagati_admin_2fa";
const CHALLENGE_PATH = "/api/admin";
const AUDIENCE = { code: "bagati-admin-2fa-code", enroll: "bagati-admin-2fa-enroll" } as const;
export type ChallengePurpose = keyof typeof AUDIENCE;

function signingKey() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  return new TextEncoder().encode(value);
}

/** Changes whenever the password changes, so a challenge issued before a password change is useless. */
function passwordFingerprint(passwordHash: string) {
  return createHash("sha256").update(`bagati-admin-2fa-pw:${passwordHash}`).digest("base64url").slice(0, 22);
}

export async function challengeCookie(userId: string, passwordHash: string, purpose: ChallengePurpose) {
  const seconds = purpose === "code" ? ADMIN_2FA_CHALLENGE_SECONDS : ADMIN_2FA_ENROLL_CHALLENGE_SECONDS;
  const token = await new SignJWT({ sub: userId, pwf: passwordFingerprint(passwordHash) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("bagati")
    .setAudience(AUDIENCE[purpose])
    .setIssuedAt()
    .setExpirationTime(`${seconds}s`)
    .sign(signingKey());
  return { name: ADMIN_2FA_CHALLENGE_COOKIE, value: token, httpOnly: true, sameSite: "strict" as const, secure: await requestCookieSecure(), path: CHALLENGE_PATH, maxAge: seconds };
}

export async function expiredChallengeCookie() {
  return { name: ADMIN_2FA_CHALLENGE_COOKIE, value: "", httpOnly: true, sameSite: "strict" as const, secure: await requestCookieSecure(), path: CHALLENGE_PATH, maxAge: 0, expires: new Date(0) };
}

export type ChallengeAdmin = { id: string; email: string; passwordHash: string };

/** The admin a valid challenge cookie belongs to. Re-checks role ADMIN, active and unchanged password. */
export async function readChallenge(request: NextRequest, purpose: ChallengePurpose): Promise<ChallengeAdmin | null> {
  const token = request.cookies.get(ADMIN_2FA_CHALLENGE_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ["HS256"], issuer: "bagati", audience: AUDIENCE[purpose] });
    if (typeof payload.sub !== "string" || typeof payload.pwf !== "string") return null;
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true, role: true, isActive: true, passwordHash: true } });
    if (!user || user.role !== "ADMIN" || !user.isActive || passwordFingerprint(user.passwordHash) !== payload.pwf) return null;
    return { id: user.id, email: user.email, passwordHash: user.passwordHash };
  } catch {
    return null;
  }
}

export type EnrollmentActor = { userId: string; email: string; via: "session" | "challenge" };

/**
 * Who may set up 2FA: a signed-in ADMIN (optional enrollment from the security page) or, when 2FA is required,
 * an admin holding the forced-enrollment challenge issued after a correct password.
 */
export async function resolveEnrollmentActor(request: NextRequest): Promise<EnrollmentActor | null> {
  const admin = await requireRole("ADMIN");
  if (admin) return { userId: admin.id, email: admin.email, via: "session" };
  const challenged = await readChallenge(request, "enroll");
  return challenged ? { userId: challenged.id, email: challenged.email, via: "challenge" } : null;
}

export async function twoFactorStatus(userId: string) {
  const [row, remainingRecoveryCodes] = await Promise.all([
    prisma.adminTwoFactor.findUnique({ where: { userId }, select: { enrolledAt: true, lockedUntil: true } }),
    prisma.adminRecoveryCode.count({ where: { userId, usedAt: null } }),
  ]);
  return {
    enrolled: Boolean(row?.enrolledAt),
    enrolledAt: row?.enrolledAt ?? null,
    lockedUntil: row?.lockedUntil && row.lockedUntil > new Date() ? row.lockedUntil : null,
    remainingRecoveryCodes: row?.enrolledAt ? remainingRecoveryCodes : 0,
    required: isAdmin2faRequired(),
    keyStatus: admin2faKeyStatus(),
  };
}

async function audit(actorId: string, action: string, metadata?: Prisma.InputJsonValue, client: Prisma.TransactionClient | typeof prisma = prisma) {
  await client.auditLog.create({ data: { actorId, action, entityType: "User", entityId: actorId, ...(metadata ? { metadata } : {}) } });
}

export class Admin2faError extends Error {
  constructor(readonly code: "KEY_UNAVAILABLE" | "ALREADY_ENROLLED" | "NO_PENDING_ENROLLMENT" | "INVALID_CODE" | "RATE_LIMITED" | "REQUIRED" | "NOT_ENROLLED" | "INVALID_PASSWORD") {
    super(code);
    this.name = "Admin2faError";
  }
}

/** Starts (or restarts) enrollment: a new secret is stored encrypted with enrolledAt = null. */
export async function startEnrollment(actor: EnrollmentActor) {
  if (admin2faKeyStatus() !== "configured") throw new Admin2faError("KEY_UNAVAILABLE");
  const existing = await prisma.adminTwoFactor.findUnique({ where: { userId: actor.userId }, select: { enrolledAt: true } });
  if (existing?.enrolledAt) throw new Admin2faError("ALREADY_ENROLLED");
  const secret = generateTotpSecret();
  const secretEncrypted = encryptTotpSecret(secret, actor.userId);
  await prisma.adminTwoFactor.upsert({
    where: { userId: actor.userId },
    create: { userId: actor.userId, secretEncrypted },
    update: { secretEncrypted, enrolledAt: null, lastUsedStep: null, failedAttempts: 0, lockedUntil: null },
  });
  const uri = otpauthUri({ issuer: "BAGATI", account: actor.email, secret });
  return { otpauthUri: uri, manualKey: formatManualKey(secret), qrSvg: qrSvg(uri, { title: "BAGATI 2FA QR kodu" }) };
}

async function consumeCodeRateLimits(request: NextRequest, userId: string) {
  const userOk = await consumeAuthRateLimit(authRateLimitKey("admin-2fa", `user:${userId}`), ADMIN_2FA_USER_RATE_LIMIT.limit, ADMIN_2FA_USER_RATE_LIMIT.windowMs);
  // Per client IP; when the IP is unknown, one shared stricter bucket (fixed window, never permanent).
  const ipBucket = admin2faIpBucket(request.headers, ADMIN_2FA_IP_RATE_LIMIT);
  const ipOk = await consumeAuthRateLimit(ipBucket.key, ipBucket.limit, ipBucket.windowMs);
  return userOk && ipOk;
}

/** Activates a pending enrollment with one valid code; returns the recovery codes (shown once). */
export async function activateEnrollment(request: NextRequest, actor: EnrollmentActor, code: unknown) {
  if (!(await consumeCodeRateLimits(request, actor.userId))) throw new Admin2faError("RATE_LIMITED");
  const pending = await prisma.adminTwoFactor.findUnique({ where: { userId: actor.userId } });
  if (!pending || pending.enrolledAt) throw new Admin2faError(pending ? "ALREADY_ENROLLED" : "NO_PENDING_ENROLLMENT");
  let secret: Buffer;
  try { secret = decryptTotpSecret(pending.secretEncrypted, actor.userId); }
  catch (error) { throw error instanceof Admin2faKeyError ? new Admin2faError("KEY_UNAVAILABLE") : error; }
  const result = verifyTotp({ key: secret, code, nowMs: Date.now(), lastUsedStep: null });
  if (!result.ok) {
    await audit(actor.userId, "ADMIN_2FA_FAILED", { stage: "enrollment", reason: result.reason });
    throw new Admin2faError("INVALID_CODE");
  }
  const codes = generateRecoveryCodes();
  const hashes = await Promise.all(codes.map(hashRecoveryCode));
  await prisma.$transaction(async (tx) => {
    const activated = await tx.adminTwoFactor.updateMany({
      where: { userId: actor.userId, enrolledAt: null, secretEncrypted: pending.secretEncrypted },
      data: { enrolledAt: new Date(), lastUsedStep: result.step, failedAttempts: 0, lockedUntil: null },
    });
    if (activated.count !== 1) throw new Admin2faError("NO_PENDING_ENROLLMENT");
    await tx.adminRecoveryCode.deleteMany({ where: { userId: actor.userId } });
    await tx.adminRecoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId: actor.userId, codeHash })) });
    await audit(actor.userId, "ADMIN_2FA_ENROLLED", { via: actor.via, recoveryCodes: codes.length }, tx);
  });
  return codes;
}

export type SecondFactorResult =
  | { ok: true; method: "totp" | "recovery"; remainingRecoveryCodes?: number }
  | { ok: false; reason: "locked" | "invalid" | "rate-limited" | "key-unavailable" | "not-enrolled"; lockedUntil?: Date };

const CODE_PATH = "/api/admin/login/2fa";

/**
 * Checks a TOTP code or a recovery code for an enrolled admin, with per-user/per-IP rate limits, a lockout after
 * repeated failures, TOTP replay protection and single-use recovery codes. Failures are audited (without the
 * code) and reported to the Security Center.
 */
export async function verifySecondFactor(request: NextRequest, userId: string, input: { code?: unknown; recoveryCode?: unknown }): Promise<SecondFactorResult> {
  const now = new Date();
  const row = await prisma.adminTwoFactor.findUnique({ where: { userId } });
  if (!row?.enrolledAt) return { ok: false, reason: "not-enrolled" };
  if (isSecondFactorLocked(row, now)) return { ok: false, reason: "locked", lockedUntil: row.lockedUntil ?? undefined };
  if (!(await consumeCodeRateLimits(request, userId))) {
    await captureApplicationSecurityEvent({ request, eventType: "RATE_LIMIT_VIOLATION", path: CODE_PATH });
    return { ok: false, reason: "rate-limited" };
  }

  const useRecovery = input.recoveryCode !== undefined && input.recoveryCode !== null && input.recoveryCode !== "";
  if (useRecovery) {
    const normalized = normalizeRecoveryCode(input.recoveryCode);
    if (normalized) {
      const candidates = await prisma.adminRecoveryCode.findMany({ where: { userId, usedAt: null }, select: { id: true, codeHash: true } });
      for (const candidate of candidates) {
        if (!(await verifyRecoveryCode(normalized, candidate.codeHash))) continue;
        const used = await prisma.adminRecoveryCode.updateMany({ where: { id: candidate.id, usedAt: null }, data: { usedAt: now } });
        if (used.count !== 1) break; // Used concurrently: treat as invalid.
        await prisma.adminTwoFactor.update({ where: { userId }, data: { failedAttempts: 0, lockedUntil: null } });
        const remaining = await prisma.adminRecoveryCode.count({ where: { userId, usedAt: null } });
        await audit(userId, "ADMIN_2FA_RECOVERY_CODE_USED", { remainingRecoveryCodes: remaining });
        return { ok: true, method: "recovery", remainingRecoveryCodes: remaining };
      }
    }
    return registerFailure(request, userId, "recovery");
  }

  let secret: Buffer;
  try { secret = decryptTotpSecret(row.secretEncrypted, userId); }
  catch (error) {
    if (error instanceof Admin2faKeyError) return { ok: false, reason: "key-unavailable" };
    throw error;
  }
  const result = verifyTotp({ key: secret, code: input.code, nowMs: now.getTime(), lastUsedStep: row.lastUsedStep });
  if (result.ok) {
    // Conditional update: two requests with the same code cannot both pass.
    const accepted = await prisma.adminTwoFactor.updateMany({
      where: { userId, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: result.step } }] },
      data: { lastUsedStep: result.step, failedAttempts: 0, lockedUntil: null },
    });
    if (accepted.count === 1) return { ok: true, method: "totp" };
  }
  return registerFailure(request, userId, "totp", result.ok ? "replay" : result.reason);
}

async function registerFailure(request: NextRequest, userId: string, method: "totp" | "recovery", reason = "mismatch"): Promise<SecondFactorResult> {
  const now = new Date();
  const next = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ failedAttempts: number; lockedUntil: Date | null }[]>`
      SELECT "failedAttempts", "lockedUntil" FROM "AdminTwoFactor" WHERE "userId" = ${userId} FOR UPDATE`;
    if (!locked) return null;
    const state = afterFailedSecondFactor({ failedAttempts: locked.failedAttempts, lockedUntil: locked.lockedUntil }, now);
    await tx.adminTwoFactor.update({ where: { userId }, data: { failedAttempts: state.failedAttempts, lockedUntil: state.lockedUntil } });
    await audit(userId, "ADMIN_2FA_FAILED", { stage: "login", method, reason, failedAttempts: state.failedAttempts }, tx);
    if (state.lockedNow) await audit(userId, "ADMIN_2FA_LOCKED", { lockedUntil: state.lockedUntil?.toISOString() ?? null }, tx);
    return state;
  });
  await captureApplicationSecurityEvent({ request, eventType: next?.lockedNow ? "RATE_LIMIT_VIOLATION" : "LOGIN_FAILURE", path: CODE_PATH });
  if (next?.lockedNow) return { ok: false, reason: "locked", lockedUntil: next.lockedUntil ?? undefined };
  return { ok: false, reason: "invalid" };
}

/** Turns 2FA off after the password and a current code (or recovery code). Not allowed while 2FA is required. */
export async function disableTwoFactor(request: NextRequest, userId: string, keepSessionId: string | null, input: { password: unknown; code?: unknown; recoveryCode?: unknown }) {
  if (isAdmin2faRequired()) throw new Admin2faError("REQUIRED");
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  const { default: bcrypt } = await import("bcryptjs");
  if (!user || typeof input.password !== "string" || input.password.length > 128 || !(await bcrypt.compare(input.password, user.passwordHash))) {
    await audit(userId, "ADMIN_2FA_FAILED", { stage: "disable", reason: "password" });
    await captureApplicationSecurityEvent({ request, eventType: "LOGIN_FAILURE", path: "/api/admin/2fa/disable" });
    throw new Admin2faError("INVALID_PASSWORD");
  }
  const factor = await verifySecondFactor(request, userId, { code: input.code, recoveryCode: input.recoveryCode });
  if (!factor.ok) {
    if (factor.reason === "not-enrolled") throw new Admin2faError("NOT_ENROLLED");
    if (factor.reason === "rate-limited" || factor.reason === "locked") throw new Admin2faError("RATE_LIMITED");
    if (factor.reason === "key-unavailable") throw new Admin2faError("KEY_UNAVAILABLE");
    throw new Admin2faError("INVALID_CODE");
  }
  return prisma.$transaction(async (tx) => {
    await tx.adminRecoveryCode.deleteMany({ where: { userId } });
    await tx.adminTwoFactor.delete({ where: { userId } });
    const revoked = await tx.authSession.updateMany({ where: { userId, revokedAt: null, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) }, data: { revokedAt: new Date() } });
    await audit(userId, "ADMIN_2FA_DISABLED", { method: factor.method, revokedOtherSessions: revoked.count }, tx);
    return revoked.count;
  });
}

/** Messages shown to the admin; they never reveal whether the password or the code was wrong beyond what is needed. */
export function admin2faErrorMessage(code: Admin2faError["code"]): { status: number; error: string } {
  switch (code) {
    case "KEY_UNAVAILABLE": return { status: 503, error: "İki mərhələli təsdiq hazırda aktivləşdirilə bilməz: server açarı (BAGATI_ADMIN_2FA_KEY) konfiqurasiya edilməyib." };
    case "ALREADY_ENROLLED": return { status: 409, error: "İki mərhələli təsdiq artıq aktivdir." };
    case "NO_PENDING_ENROLLMENT": return { status: 409, error: "Qeydiyyat tapılmadı. QR kodu yenidən yaradın." };
    case "INVALID_CODE": return { status: 400, error: "Kod yanlışdır və ya vaxtı keçib." };
    case "RATE_LIMITED": return { status: 429, error: "Çox sayda cəhd edildi. Bir müddət sonra yenidən yoxlayın." };
    case "REQUIRED": return { status: 409, error: "İki mərhələli təsdiq bütün adminlər üçün məcburidir və söndürülə bilməz." };
    case "NOT_ENROLLED": return { status: 409, error: "İki mərhələli təsdiq aktiv deyil." };
    case "INVALID_PASSWORD": return { status: 400, error: "Şifrə yanlışdır." };
  }
}
