/**
 * Admin sign-in audit rows (SECURITY-PAGE-1):
 * - ADMIN_LOGIN after a successful admin sign-in (password-only, 2FA code, or forced 2FA enrollment), keyed by the
 *   session reference so the security page can show the full IP of each admin session (AuthSession stores only a mask).
 * - ADMIN_LOGIN_FAILED only when the attempted e-mail belongs to an EXISTING ADMIN account (actorId = that admin).
 *   Attempted e-mails of customers, sellers or unknown accounts are never stored: the row has no e-mail field at all.
 *
 * Writes are fire-and-forget: the login response never waits for them and a failure is only logged. Not waiting also
 * keeps login timing equal for admin and non-admin e-mails (SEC-FIX-1 L9).
 */
import type { Prisma } from "@prisma/client";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuthFailure } from "@/lib/auth-logging";
import { readSessionClaims } from "@/lib/auth";
import { sessionReference } from "@/lib/admin-sessions";
import { trustedCloudflareClientIp } from "@/lib/trusted-proxy";

export type LoginPortal = "admin" | "customer" | "vendor";
export type AdminLoginMethod = "password" | "2fa" | "2fa-enroll";
export type AdminLoginFailureReason = "password" | "password-disabled" | "inactive";

export type AuditRow = { actorId: string; action: string; entityType: string; entityId: string | null; metadata: Prisma.InputJsonValue };

/** The ADMIN_LOGIN_FAILED row, or null when the account is unknown or not an admin (nothing is stored then). */
export function adminLoginFailureRow(user: { id: string; role: Role } | null | undefined, portal: LoginPortal, reason: AdminLoginFailureReason, ip: string | null): AuditRow | null {
  if (!user || user.role !== "ADMIN") return null;
  return { actorId: user.id, action: "ADMIN_LOGIN_FAILED", entityType: "User", entityId: user.id, metadata: { ip, portal, reason } };
}

export function adminLoginRow(userId: string, sessionId: string, method: AdminLoginMethod, ip: string | null): AuditRow {
  return { actorId: userId, action: "ADMIN_LOGIN", entityType: "AuthSession", entityId: sessionReference(sessionId), metadata: { ip, method, portal: "admin" } };
}

type Writer = (row: AuditRow) => Promise<unknown>;
const prismaWriter: Writer = (row) => prisma.auditLog.create({ data: row });

/** Starts the write and returns at once; never throws, never rejects. */
export function writeAuditInBackground(row: AuditRow | null, write: Writer = prismaWriter): void {
  if (!row) return;
  try {
    void write(row).catch((error) => logAuthFailure("admin_login_audit", error));
  } catch (error) {
    logAuthFailure("admin_login_audit", error);
  }
}

/** Failed sign-in on any portal: recorded only for an existing ADMIN account. */
export function auditAdminLoginFailure(request: Request, user: { id: string; role: Role } | null | undefined, portal: LoginPortal, reason: AdminLoginFailureReason): void {
  if (!user || user.role !== "ADMIN") return;
  let ip: string | null = null;
  try { ip = trustedCloudflareClientIp(request.headers); } catch { ip = null; }
  writeAuditInBackground(adminLoginFailureRow(user, portal, reason, ip));
}

/** Successful admin sign-in: the session id is read back from the new session cookie. */
export function auditAdminLogin(request: Request, userId: string, sessionCookieValue: string, method: AdminLoginMethod): void {
  void (async () => {
    try {
      const claims = await readSessionClaims(sessionCookieValue);
      if (!claims) return;
      let ip: string | null = null;
      try { ip = trustedCloudflareClientIp(request.headers); } catch { ip = null; }
      writeAuditInBackground(adminLoginRow(userId, claims.sessionId, method, ip));
    } catch (error) {
      logAuthFailure("admin_login_audit", error);
    }
  })();
}
