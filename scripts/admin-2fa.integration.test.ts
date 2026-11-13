/**
 * Admin 2FA and admin session management against the isolated verification PostgreSQL cluster.
 *
 * Safety: uses ONLY BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL and refuses unless the host is loopback, the port is
 * exactly 5433 and the database name contains "verify". DATABASE_URL is overwritten in-process before lib/prisma is
 * imported; .env is never read. A throwaway BAGATI_ADMIN_2FA_KEY is generated in-process. Fixture rows are removed
 * in `finally`. Skips (NOT VERIFIED) when the cluster or the AdminTwoFactor table is missing; it never migrates.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const VERIFY_URL_ENV = "BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL";

function guardedVerifyUrl(): { url: string } | { refuse: string } | { skip: string } {
  const raw = process.env[VERIFY_URL_ENV];
  if (!raw) return { skip: `${VERIFY_URL_ENV} is not set` };
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { refuse: `${VERIFY_URL_ENV} is not a valid URL` }; }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) return { refuse: "verify database host must be loopback" };
  if (parsed.port !== "5433") return { refuse: "verify database port must be exactly 5433" };
  if (!database.includes("verify")) return { refuse: "verify database name must contain \"verify\"" };
  return { url: raw };
}

test("admin 2FA enrollment, login codes, replay, lockout, recovery codes, disable and session revocation", { timeout: 180_000 }, async (t) => {
  const guard = guardedVerifyUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  process.env.DATABASE_URL = guard.url;
  process.env.SESSION_SECRET = randomBytes(32).toString("hex");
  process.env.BAGATI_ADMIN_2FA_KEY = randomBytes(32).toString("base64");
  delete process.env.BAGATI_ADMIN_2FA_REQUIRED;
  delete process.env.BAGATI_TRUST_CLOUDFLARE_IP;

  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  const tag = randomUUID().replace(/-/g, "").slice(0, 10);
  const startedAt = new Date(Date.now() - 1000);
  let adminId = "";
  try {
    try { await prisma.$queryRaw`SELECT 1`; } catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    const [where] = await prisma.$queryRaw<{ db: string; port: number }[]>`SELECT current_database() AS db, inet_server_port() AS port`;
    assert.ok(where.db.includes("verify"));
    assert.equal(Number(where.port), 5433);
    const [table] = await prisma.$queryRaw<{ t: string | null }[]>`SELECT to_regclass('public."AdminTwoFactor"')::text AS t`;
    if (!table?.t) return t.skip("NOT VERIFIED: AdminTwoFactor table missing (migration 20261113020000 not applied)");

    const { NextRequest } = await import("next/server");
    const bcrypt = (await import("bcryptjs")).default;
    const twoFactor = await import("../lib/admin-2fa");
    const { decryptTotpSecret } = await import("../lib/admin-2fa-crypto");
    const { hotp, totpStep, base32Encode } = await import("../lib/totp");
    const { revokeOtherOwnSessions, revokeOwnSession, listActiveSessions } = await import("../lib/admin-sessions");
    const { authRateLimitKey, clearAuthRateLimit } = await import("../lib/auth-rate-limit");
    const request = () => new NextRequest("http://localhost:3000/api/admin/login/2fa", { method: "POST", headers: { host: "localhost:3000" } });

    const password = `Verify-${tag}-password`;
    const admin = await prisma.user.create({ data: { email: `twofa-${tag}@verify.invalid`, passwordHash: await bcrypt.hash(password, 10), role: "ADMIN", emailVerifiedAt: new Date() } });
    adminId = admin.id;
    const actor = { userId: admin.id, email: admin.email, via: "session" as const };

    // 1. Enrollment: secret is stored encrypted, bound to the user, and not active yet.
    const setup = await twoFactor.startEnrollment(actor);
    assert.match(setup.qrSvg, /^<svg /);
    const pending = await prisma.adminTwoFactor.findUniqueOrThrow({ where: { userId: admin.id } });
    assert.equal(pending.enrolledAt, null);
    const secret = decryptTotpSecret(pending.secretEncrypted, admin.id);
    assert.equal(setup.manualKey.replace(/ /g, ""), base32Encode(secret));
    assert.doesNotMatch(pending.secretEncrypted, new RegExp(base32Encode(secret)));
    assert.equal((await twoFactor.verifySecondFactor(request(), admin.id, { code: hotp(secret, totpStep(Date.now())) })).ok, false, "not enrolled yet");

    // 2. Activation with a wrong code fails; with the current code it returns 10 recovery codes stored as hashes.
    await assert.rejects(twoFactor.activateEnrollment(request(), actor, "000000"), (error: unknown) => error instanceof twoFactor.Admin2faError && error.code === "INVALID_CODE");
    const step = totpStep(Date.now());
    const recoveryCodes = await twoFactor.activateEnrollment(request(), actor, hotp(secret, step));
    assert.equal(recoveryCodes.length, 10);
    const stored = await prisma.adminRecoveryCode.findMany({ where: { userId: admin.id } });
    assert.equal(stored.length, 10);
    for (const row of stored) assert.ok(row.codeHash.startsWith("scrypt$") && !recoveryCodes.some((code) => row.codeHash.includes(code.replace("-", ""))));
    const enrolled = await prisma.adminTwoFactor.findUniqueOrThrow({ where: { userId: admin.id } });
    assert.ok(enrolled.enrolledAt);
    assert.equal(enrolled.lastUsedStep, step);
    await assert.rejects(twoFactor.startEnrollment(actor), (error: unknown) => error instanceof twoFactor.Admin2faError && error.code === "ALREADY_ENROLLED");

    // 3. Login codes: the activation code is a replay; the next step (inside the +/-1 window) works once.
    assert.deepEqual(await twoFactor.verifySecondFactor(request(), admin.id, { code: hotp(secret, step) }), { ok: false, reason: "invalid" }, "replay of the activation code");
    assert.deepEqual(await twoFactor.verifySecondFactor(request(), admin.id, { code: hotp(secret, step + 1) }), { ok: true, method: "totp" });
    assert.deepEqual(await twoFactor.verifySecondFactor(request(), admin.id, { code: hotp(secret, step + 1) }), { ok: false, reason: "invalid" }, "same code twice");
    assert.equal((await prisma.adminTwoFactor.findUniqueOrThrow({ where: { userId: admin.id } })).lastUsedStep, step + 1);
    assert.equal((await prisma.adminTwoFactor.findUniqueOrThrow({ where: { userId: admin.id } })).failedAttempts, 1, "a success resets the counter; only the later replay counts");

    // 4. Lockout after 5 consecutive failures; a correct code is refused while locked.
    for (let i = 0; i < 3; i += 1) assert.equal((await twoFactor.verifySecondFactor(request(), admin.id, { code: "111111" })).ok, false);
    const lockResult = await twoFactor.verifySecondFactor(request(), admin.id, { code: "222222" });
    assert.equal(lockResult.ok, false);
    assert.equal(!lockResult.ok && lockResult.reason, "locked");
    const lockedRow = await prisma.adminTwoFactor.findUniqueOrThrow({ where: { userId: admin.id } });
    assert.equal(lockedRow.failedAttempts, 5);
    assert.ok(lockedRow.lockedUntil && lockedRow.lockedUntil.getTime() > Date.now() + 14 * 60_000);
    const whileLocked = await twoFactor.verifySecondFactor(request(), admin.id, { code: hotp(secret, totpStep(Date.now()) + 1) });
    assert.equal(!whileLocked.ok && whileLocked.reason, "locked");
    const events = await prisma.securityEvent.groupBy({ by: ["eventType"], where: { path: "/api/admin/login/2fa", occurredAt: { gte: startedAt } }, _count: { _all: true } });
    const eventCount = Object.fromEntries(events.map((row) => [row.eventType, row._count._all]));
    assert.ok((eventCount.LOGIN_FAILURE ?? 0) >= 4, JSON.stringify(eventCount));
    assert.ok((eventCount.RATE_LIMIT_VIOLATION ?? 0) >= 1, JSON.stringify(eventCount));

    // 5. After the lock expires: recovery codes work once each.
    await prisma.adminTwoFactor.update({ where: { userId: admin.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await clearAuthRateLimit(authRateLimitKey("admin-2fa", `user:${admin.id}`));
    const recovered = await twoFactor.verifySecondFactor(request(), admin.id, { recoveryCode: recoveryCodes[0].toLowerCase() });
    assert.deepEqual(recovered, { ok: true, method: "recovery", remainingRecoveryCodes: 9 });
    assert.deepEqual(await twoFactor.verifySecondFactor(request(), admin.id, { recoveryCode: recoveryCodes[0] }), { ok: false, reason: "invalid" }, "single use");
    assert.equal(await prisma.adminRecoveryCode.count({ where: { userId: admin.id, usedAt: null } }), 9);

    // 6. Sessions: list, revoke one (not the current one), revoke all others.
    const sessionIds = [randomUUID(), randomUUID(), randomUUID()];
    const otherUser = await prisma.user.create({ data: { email: `twofa-other-${tag}@verify.invalid`, passwordHash: "x", role: "ADMIN" } });
    const foreignSession = randomUUID();
    await prisma.authSession.createMany({ data: [
      ...sessionIds.map((id, index) => ({ id, userId: admin.id, expiresAt: new Date(Date.now() + 3600_000), lastSeenAt: new Date(Date.now() - index * 60_000), ipMasked: "203.0.*.*", userAgent: "Chrome 140 · Windows" })),
      { id: foreignSession, userId: otherUser.id, expiresAt: new Date(Date.now() + 3600_000) },
    ] });
    const listed = await listActiveSessions(admin.id, sessionIds[0]);
    assert.deepEqual(listed.map((row) => row.id), sessionIds);
    assert.equal(listed.filter((row) => row.current).length, 1);
    assert.deepEqual(await revokeOwnSession(admin.id, sessionIds[0], sessionIds[0]), { revoked: 0, reason: "current" });
    assert.deepEqual(await revokeOwnSession(admin.id, foreignSession, sessionIds[0]), { revoked: 0, reason: "not-found" }, "another admin's session cannot be revoked");
    assert.deepEqual(await revokeOwnSession(admin.id, sessionIds[1], sessionIds[0]), { revoked: 1, reason: null });
    assert.equal(await revokeOtherOwnSessions(admin.id, sessionIds[0], "manual"), 1);
    assert.deepEqual((await listActiveSessions(admin.id, sessionIds[0])).map((row) => row.id), [sessionIds[0]]);
    assert.equal((await prisma.authSession.findUniqueOrThrow({ where: { id: foreignSession } })).revokedAt, null);
    await prisma.user.delete({ where: { id: otherUser.id } });

    // 7. Disable: wrong password refused; password + current code removes 2FA and revokes other sessions.
    const extra = randomUUID();
    await prisma.authSession.create({ data: { id: extra, userId: admin.id, expiresAt: new Date(Date.now() + 3600_000) } });
    await assert.rejects(twoFactor.disableTwoFactor(request(), admin.id, sessionIds[0], { password: "wrong", code: "123456" }), (error: unknown) => error instanceof twoFactor.Admin2faError && error.code === "INVALID_PASSWORD");
    const revoked = await twoFactor.disableTwoFactor(request(), admin.id, sessionIds[0], { password, recoveryCode: recoveryCodes[1] });
    assert.equal(revoked, 1);
    assert.equal(await prisma.adminTwoFactor.count({ where: { userId: admin.id } }), 0);
    assert.equal(await prisma.adminRecoveryCode.count({ where: { userId: admin.id } }), 0);
    assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: extra } })).revokedAt);
    assert.equal((await prisma.authSession.findUniqueOrThrow({ where: { id: sessionIds[0] } })).revokedAt, null, "current session kept");

    // 8. Required mode: disabling is refused.
    process.env.BAGATI_ADMIN_2FA_REQUIRED = "true";
    await assert.rejects(twoFactor.disableTwoFactor(request(), admin.id, null, { password, code: "123456" }), (error: unknown) => error instanceof twoFactor.Admin2faError && error.code === "REQUIRED");
    delete process.env.BAGATI_ADMIN_2FA_REQUIRED;

    // 9. Audit trail: expected actions present, and no secret, code or hash in any metadata.
    const audit = await prisma.auditLog.findMany({ where: { actorId: admin.id }, orderBy: { createdAt: "asc" } });
    const actions = new Set(audit.map((row) => row.action));
    for (const action of ["ADMIN_2FA_ENROLLED", "ADMIN_2FA_FAILED", "ADMIN_2FA_LOCKED", "ADMIN_2FA_RECOVERY_CODE_USED", "ADMIN_SESSION_REVOKED", "ADMIN_SESSIONS_REVOKED", "ADMIN_2FA_DISABLED"]) assert.ok(actions.has(action), action);
    const metadata = JSON.stringify(audit.map((row) => row.metadata));
    assert.doesNotMatch(metadata, new RegExp(base32Encode(secret)));
    for (const code of recoveryCodes) assert.doesNotMatch(metadata, new RegExp(code.replace("-", "-?")));
    assert.doesNotMatch(metadata, /scrypt\$|v1\.[\w-]+\./);
    assert.equal(metadata.includes(password), false, "the password value never appears");
    assert.equal(audit.find((row) => row.action === "ADMIN_SESSION_REVOKED")?.entityId, sessionIds[1].slice(0, 8));
    t.diagnostic(`audit actions: ${[...actions].sort().join(", ")}`);
  } finally {
    if (adminId) {
      await prisma.auditLog.deleteMany({ where: { actorId: adminId } }).catch(() => undefined);
      await clearAuthRateLimit_safe(adminId);
      await prisma.user.deleteMany({ where: { email: { endsWith: `-${tag}@verify.invalid` } } }).catch(() => undefined);
    }
    await prisma.securityEvent.deleteMany({ where: { path: { in: ["/api/admin/login/2fa", "/api/admin/2fa/disable"] }, occurredAt: { gte: startedAt }, sourceIp: null } }).catch(() => undefined);
    await prisma.$disconnect();
    const { prisma: shared } = await import("../lib/prisma").catch(() => ({ prisma: null }));
    await shared?.$disconnect().catch(() => undefined);
  }

  async function clearAuthRateLimit_safe(userId: string) {
    try {
      const { authRateLimitKey, clearAuthRateLimit } = await import("../lib/auth-rate-limit");
      await clearAuthRateLimit(authRateLimitKey("admin-2fa", `user:${userId}`));
    } catch { /* best effort */ }
  }
});
