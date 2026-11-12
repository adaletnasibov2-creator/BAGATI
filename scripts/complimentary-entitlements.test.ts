import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  changeComplimentary,
  COMPLIMENTARY_AUDIT,
  complimentaryReasonSchema,
  grantComplimentary,
  parseComplimentaryEndsAt,
  revokeComplimentary,
} from "../lib/complimentary-entitlements";
import { getStorePublicationBlockers, type StorePublicationState } from "../lib/admin-store-product-publishing";

const source = (path: string) => readFileSync(path, "utf8");

/** Minimal in-memory transaction with the calls the grant module makes. */
function fakeTx() {
  type Row = { id: string; storeId: string; tier: "BASIC" | "PRO"; endsAt: Date | null; grantReason: string; grantedAt: Date; grantedByAdminId: string; revokedAt: Date | null; revokedByAdminId: string | null; revokeReason: string | null };
  const rows: Row[] = [];
  const audits: Array<{ action: string; entityId: string; metadata: Record<string, unknown> }> = [];
  let seq = 0;
  const pick = (row: Row) => ({ id: row.id, tier: row.tier, endsAt: row.endsAt, grantReason: row.grantReason, grantedAt: row.grantedAt });
  const tx = {
    storeComplimentaryEntitlement: {
      async findFirst({ where }: { where: { storeId: string; revokedAt: null } }) {
        const row = rows.filter((r) => r.storeId === where.storeId && r.revokedAt === null).at(-1);
        return row ? pick(row) : null;
      },
      async create({ data }: { data: { storeId: string; grantedByAdminId: string; grantReason: string; tier: "BASIC" | "PRO"; endsAt: Date | null } }) {
        if (rows.some((r) => r.storeId === data.storeId && r.revokedAt === null)) throw Object.assign(new Error("unique"), { code: "P2002" });
        const row: Row = { id: `grant-${++seq}`, grantedAt: new Date(), revokedAt: null, revokedByAdminId: null, revokeReason: null, ...data };
        rows.push(row);
        return pick(row);
      },
      async updateMany({ where, data }: { where: { id: string; revokedAt: null }; data: { revokedAt: Date; revokedByAdminId: string; revokeReason: string } }) {
        const row = rows.find((r) => r.id === where.id && r.revokedAt === null);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    auditLog: {
      async create({ data }: { data: { action: string; entityId: string; metadata: Record<string, unknown> } }) {
        audits.push(data);
        return { id: `audit-${audits.length}` };
      },
    },
  };
  return { tx, rows, audits };
}

test("end date: empty means no end; it must be in the future", () => {
  const now = new Date("2026-11-12T12:00:00.000Z");
  assert.deepEqual(parseComplimentaryEndsAt(null, now), { ok: true, endsAt: null });
  assert.deepEqual(parseComplimentaryEndsAt(undefined, now), { ok: true, endsAt: null });
  assert.equal(parseComplimentaryEndsAt("2026-11-12", now).ok, false);
  assert.equal(parseComplimentaryEndsAt("2026-11-01", now).ok, false);
  assert.deepEqual(parseComplimentaryEndsAt("2026-12-31", now), { ok: true, endsAt: new Date("2026-12-31T00:00:00.000Z") });
});

test("reason is required (at least 8 characters)", () => {
  assert.equal(complimentaryReasonSchema.safeParse("").success, false);
  assert.equal(complimentaryReasonSchema.safeParse("   qısa ").success, false);
  assert.equal(complimentaryReasonSchema.safeParse("Tərəfdaş mağaza, 3 ay pulsuz").success, true);
});

test("grant creates one audited grant; a second grant is refused", async () => {
  const { tx, rows, audits } = fakeTx();
  const first = await grantComplimentary(tx, { storeId: "s1", adminId: "a1", tier: "BASIC", endsAt: null, reason: "Tərəfdaş mağaza", source: "ADMIN_PANEL" });
  assert.equal(first.kind, "GRANTED");
  const second = await grantComplimentary(tx, { storeId: "s1", adminId: "a1", tier: "PRO", endsAt: null, reason: "İkinci cəhd edilir", source: "ADMIN_PANEL" });
  assert.equal(second.kind, "ALREADY_GRANTED");
  assert.equal(rows.length, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, COMPLIMENTARY_AUDIT.grant);
  assert.equal(audits[0].metadata.reason, "Tərəfdaş mağaza");
});

test("change revokes the old grant and creates a new one, keeping history and an audit entry", async () => {
  const { tx, rows, audits } = fakeTx();
  await grantComplimentary(tx, { storeId: "s1", adminId: "a1", tier: "BASIC", endsAt: null, reason: "Tərəfdaş mağaza", source: "STORE_APPROVAL" });
  const endsAt = new Date(Date.now() + 30 * 86_400_000);
  const changed = await changeComplimentary(tx, { storeId: "s1", adminId: "a2", tier: "PRO", endsAt, reason: "PRO-ya keçid, 30 gün" });
  assert.equal(changed.kind, "CHANGED");
  assert.equal(rows.length, 2);
  assert.ok(rows[0].revokedAt);
  assert.equal(rows[0].revokedByAdminId, "a2");
  assert.match(rows[0].revokeReason ?? "", /PRO-ya keçid/);
  assert.equal(rows[1].tier, "PRO");
  assert.equal(rows[1].endsAt, endsAt);
  assert.equal(rows[1].revokedAt, null);
  assert.equal(audits.at(-1)?.action, COMPLIMENTARY_AUDIT.change);
  assert.equal((audits.at(-1)?.metadata.previous as { tier: string }).tier, "BASIC");
});

test("revoke needs an active grant, records who and why, and is audited", async () => {
  const { tx, rows, audits } = fakeTx();
  assert.equal((await revokeComplimentary(tx, { storeId: "s1", adminId: "a1", reason: "Səhvən verilib", source: "ADMIN_PANEL" })).kind, "NONE");
  assert.equal((await changeComplimentary(tx, { storeId: "s1", adminId: "a1", tier: "PRO", endsAt: null, reason: "Mövcud deyil" })).kind, "NONE");
  await grantComplimentary(tx, { storeId: "s1", adminId: "a1", tier: "BASIC", endsAt: null, reason: "Tərəfdaş mağaza", source: "ADMIN_PANEL" });
  const revoked = await revokeComplimentary(tx, { storeId: "s1", adminId: "a3", reason: "Ödənişli abunəlik aktivləşdirildi: test", source: "PAID_SUBSCRIPTION_ACTIVATED" });
  assert.equal(revoked.kind, "REVOKED");
  assert.equal(rows[0].revokedByAdminId, "a3");
  assert.equal(audits.at(-1)?.action, COMPLIMENTARY_AUDIT.revoke);
  assert.equal(audits.at(-1)?.metadata.source, "PAID_SUBSCRIPTION_ACTIVATED");
});

// Path (1), unit level: the store-approval code path computes visibility as `blockers.length === 0`.
const approvedCandidate: StorePublicationState = {
  status: "ACTIVE", isActive: true, legalInfoApproved: true, adminManaged: false, vendorActive: true, cityActive: true,
  sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: "Satıcı", voen: "1234567890", legalAddress: null,
  subscriptionStatus: "PENDING", planSlug: "basic", planActive: true, periodStart: null, periodEnd: null, complimentary: null,
};

test("path (1): approval without the free option and without an active paid subscription keeps the subscription blocker", () => {
  const blockers = getStorePublicationBlockers(approvedCandidate);
  assert.deepEqual(blockers, ["Satış üçün aktiv, qüvvədə olan Basic və ya Pro abunəliyi tələb olunur."]);
  assert.deepEqual(getStorePublicationBlockers({ ...approvedCandidate, subscriptionStatus: null, planSlug: null, planActive: false }), blockers);
});

test("path (1): approval with an active in-period paid subscription has no blockers", () => {
  assert.deepEqual(getStorePublicationBlockers({ ...approvedCandidate, subscriptionStatus: "ACTIVE", periodEnd: new Date(Date.now() + 86_400_000) }), []);
});

test("path (2): approval with the free option has no subscription blocker; an already-ended grant does", () => {
  assert.deepEqual(getStorePublicationBlockers({ ...approvedCandidate, complimentary: { tier: "BASIC", endsAt: null } }), []);
  assert.equal(getStorePublicationBlockers({ ...approvedCandidate, complimentary: { tier: "BASIC", endsAt: new Date(Date.now() - 1) } }).length, 1);
});

test("review transaction: the free option is off by default, approve-only, and its row is written after the store update", () => {
  const route = source("app/api/admin/stores/[storeId]/review/route.ts");
  const review = source("lib/store-review-transaction.ts");
  assert.match(route, /complimentary: z\.object\(\{[\s\S]*?\}\)\.optional\(\)/);
  assert.match(route, /if \(freeGrant && parsed\.data\.action !== "approve"\)/);
  assert.match(route, /freeGrant: freeGrant \? \{[^}]*\} : null/);
  assert.match(review, /const complimentary = freeGrant \? \{ tier: freeGrant\.tier, endsAt: freeGrantEndsAt \} : existingGrant;/);
  const update = review.indexOf("if (!changed.count) return { kind: \"CONFLICT\" as const };");
  const grant = review.indexOf("grantComplimentary(tx, {");
  const blockers = review.indexOf("getStorePublicationBlockers(candidateState)");
  assert.ok(blockers > 0 && blockers < update && update < grant, "blockers -> store update -> grant row");
  assert.match(review, /if \(freeGrant && existingGrant\) return \{ kind: "ALREADY_GRANTED" as const \};/);
});

test("saving an ACTIVE paid subscription revokes the free grant in the same transaction", () => {
  const save = source("lib/admin-manual-subscription.ts");
  assert.match(save, /item\.status === "ACTIVE"\s*\?\s*await revokeComplimentary\(tx, \{[\s\S]*?source: "PAID_SUBSCRIPTION_ACTIVATED"/);
});

test("the grant API is ADMIN-only, locks the store, and requires a reason for every action", () => {
  const api = source("app/api/admin/stores/[storeId]/complimentary/route.ts");
  assert.match(api, /const admin = await requireRole\("ADMIN"\);\s*if \(!admin\)/);
  assert.match(api, /FOR UPDATE/);
  assert.equal((api.match(/reason: complimentaryReasonSchema/g) ?? []).length, 3);
});
