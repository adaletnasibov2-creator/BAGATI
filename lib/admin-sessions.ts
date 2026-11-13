import { prisma } from "@/lib/prisma";
import { revokeUserSessions } from "@/lib/auth";

export type AdminSessionView = {
  id: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  expiresAt: Date;
  ipMasked: string | null;
  userAgent: string | null;
  current: boolean;
};

/** Active (not revoked, not expired) sessions of one admin, newest activity first. */
export async function listActiveSessions(userId: string, currentSessionId: string | null): Promise<AdminSessionView[]> {
  const rows = await prisma.authSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: [{ lastSeenAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 50,
    select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true, ipMasked: true, userAgent: true },
  });
  return rows.map((row) => ({ ...row, current: row.id === currentSessionId }));
}

/** Only a short prefix of a session id is written to the audit log. */
export function sessionReference(sessionId: string) {
  return sessionId.slice(0, 8);
}

export async function revokeOwnSession(userId: string, sessionId: string, currentSessionId: string | null) {
  if (sessionId === currentSessionId) return { revoked: 0, reason: "current" as const };
  const result = await prisma.authSession.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (result.count) {
    await prisma.auditLog.create({ data: { actorId: userId, action: "ADMIN_SESSION_REVOKED", entityType: "AuthSession", entityId: sessionReference(sessionId), metadata: { scope: "single" } } });
  }
  return { revoked: result.count, reason: result.count ? null : "not-found" as const };
}

export async function revokeOtherOwnSessions(userId: string, currentSessionId: string | null, reason: "manual" | "2fa-enrolled") {
  const revoked = await revokeUserSessions(userId, currentSessionId);
  await prisma.auditLog.create({ data: { actorId: userId, action: "ADMIN_SESSIONS_REVOKED", entityType: "User", entityId: userId, metadata: { scope: currentSessionId ? "others" : "all", reason, count: revoked } } });
  return revoked;
}
