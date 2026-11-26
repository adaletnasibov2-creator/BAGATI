/**
 * PILOT-FREE-ONBOARDING-1
 * G1: a seller can send a store for review without choosing a plan (lib/store-submission.ts). Approval and public
 *     visibility still need an entitlement (free grant, paid ACTIVE subscription or admin-managed).
 * G2: the approve button on the admin store list opens the store page (where the free-sale option is) instead of
 *     approving directly (components/admin-store-activation-action.tsx). Reactivate is unchanged.
 *
 * (a) a store with no subscription can be submitted;
 * (b) such a store approved WITHOUT a free grant stays hidden (isActive=false) with the subscription blocker;
 * (c) approved WITH a free grant it goes live and its ready draft is published;
 * (d) the list button no longer calls /review for approval; no new visible text in the changed files.
 * (b) and (c) run the real runStoreReviewTransaction against an in-memory fake transaction (no database).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { checkStoreSubmission } from "../lib/store-submission";
import { runStoreReviewTransaction } from "../lib/store-review-transaction";
import { isPublicStoreEligible } from "../lib/public-store-eligibility";

process.env.SESSION_SECRET ??= "pilot-free-onboarding-unit-test-secret-0123456789";

const root = process.cwd();
const BASE = "2fa3555";
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
// Scope checks compare BASE with this task's newest commit (not the working tree), so later legitimate changes to these
// files do not break them. Before the task is committed, the working tree is used.
const TASK = git("log", "--format=%H", "--grep=^PILOT-FREE-ONBOARDING-1", `${BASE}..HEAD`).trim().split(/\r?\n/).filter(Boolean)[0] ?? null;
const atTask = (path: string) => (TASK ? git("show", `${TASK}:${path}`).replace(/\r\n/g, "\n") : read(path));
const diffNames = (...paths: string[]) => (TASK ? git("diff", "--name-only", BASE, TASK, "--", ...paths) : git("diff", "--name-only", BASE, "--", ...paths)).trim();

const legalComplete = { sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: "Pilot Satıcı", voen: "1234567890", legalAddress: "Bakı" };

test("(a) a store with no subscription can be sent for review; status and legal checks stay", () => {
  const base = { status: "DRAFT", legalInfoApproved: false, adminManaged: false, hasSubscription: false, ...legalComplete };
  assert.deepEqual(checkStoreSubmission(base), { ok: true });
  assert.deepEqual(checkStoreSubmission({ ...base, status: "REJECTED" }), { ok: true });
  assert.deepEqual(checkStoreSubmission({ ...base, status: "PENDING_REVIEW" }), { ok: false, reason: "INVALID_STATUS", missingFields: [] });
  assert.deepEqual(checkStoreSubmission({ ...base, legalName: " " }), { ok: false, reason: "LEGAL_INFORMATION_INCOMPLETE", missingFields: ["legalName"] });
  // The route keeps calling checkStoreSubmission; nothing else in it changed.
  assert.match(read("app/api/vendor/[storeId]/[section]/route.ts"), /checkStoreSubmission\(\{/);
  assert.equal(diffNames("app/api/vendor"), "");
});

// ---- in-memory fake transaction for runStoreReviewTransaction (only the calls it makes) ----
type Grant = { id: string; storeId: string; tier: "BASIC" | "PRO"; endsAt: Date | null; grantReason: string; grantedAt: Date; revokedAt: Date | null };
function fakeWorld() {
  const store = {
    id: "store-pilot", name: "Pilot Mağaza", status: "PENDING_REVIEW", isActive: false, legalInfoApproved: false, adminManaged: false, reviewNote: null as string | null,
    city: { isActive: true },
    subscription: null,
    vendor: { ...legalComplete, user: { id: "user-pilot", email: "pilot@example.invalid", isActive: true } },
  };
  const products = [
    { id: "p-ready", storeId: store.id, name: "Hazır məhsul", description: null, price: "12.50", discountPrice: null, status: "DRAFT", categoryId: "cat-1", category: { isActive: true }, inventory: [{ variantId: null, quantity: 5, reserved: 0 }], variants: [] as unknown[] },
  ];
  const grants: Grant[] = [];
  const audits: Array<{ action: string }> = [];
  const activeGrantRows = () => grants.filter((g) => !g.revokedAt).sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime()).map((g) => ({ tier: g.tier, endsAt: g.endsAt }));
  const tx = {
    $queryRaw: async () => [{ id: store.id }],
    store: {
      findUnique: async () => ({ ...store, complimentaryEntitlements: activeGrantRows().slice(0, 1) }),
      updateMany: async ({ where, data }: { where: { id: string; status: string; isActive: boolean }; data: Record<string, unknown> }) => {
        if (where.id !== store.id || where.status !== store.status || where.isActive !== store.isActive) return { count: 0 };
        Object.assign(store, data);
        return { count: 1 };
      },
    },
    storeComplimentaryEntitlement: {
      findFirst: async () => {
        const row = grants.filter((g) => !g.revokedAt).sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime())[0];
        return row ? { id: row.id, tier: row.tier, endsAt: row.endsAt, grantReason: row.grantReason, grantedAt: row.grantedAt } : null;
      },
      create: async ({ data }: { data: { storeId: string; tier: "BASIC" | "PRO"; endsAt: Date | null; grantReason: string } }) => {
        const row: Grant = { id: `grant-${grants.length + 1}`, storeId: data.storeId, tier: data.tier, endsAt: data.endsAt, grantReason: data.grantReason, grantedAt: new Date(), revokedAt: null };
        grants.push(row);
        return { id: row.id, tier: row.tier, endsAt: row.endsAt, grantReason: row.grantReason, grantedAt: row.grantedAt };
      },
    },
    auditLog: { create: async ({ data }: { data: { action: string } }) => { audits.push(data); return { id: `audit-${audits.length}` }; } },
    emailOutbox: { upsert: async () => ({ id: "email-1" }) },
    notification: { create: async () => ({ id: "n-1" }) },
    product: {
      findMany: async () => products.filter((p) => p.status === "DRAFT"),
      count: async () => products.filter((p) => p.status === "ACTIVE").length,
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: { status: string } }) => {
        const product = products.find((p) => p.id === where.id && p.status === where.status);
        if (!product) return { count: 0 };
        product.status = data.status;
        return { count: 1 };
      },
    },
  };
  const publicCandidate = () => ({
    id: store.id, status: store.status, isActive: store.isActive, legalInfoApproved: store.legalInfoApproved, adminManaged: store.adminManaged,
    city: store.city, vendor: { ...legalComplete, user: { isActive: true } }, subscription: null, complimentaryEntitlements: activeGrantRows().slice(0, 1),
  });
  return { tx: tx as unknown as Prisma.TransactionClient, store, products, grants, audits, publicCandidate };
}

test("(b) approved WITHOUT a free grant and no subscription: approved but hidden, with the subscription blocker", async () => {
  const world = fakeWorld();
  const outcome = await runStoreReviewTransaction(world.tx, { storeId: world.store.id, adminId: "admin-1", action: "approve", freeGrant: null });
  assert.equal(outcome.kind, "UPDATED");
  if (outcome.kind !== "UPDATED") return;
  assert.equal(world.store.status, "ACTIVE");
  assert.equal(world.store.isActive, false);
  assert.ok(outcome.activationBlockers.includes("Satış üçün aktiv, qüvvədə olan Basic və ya Pro abunəliyi tələb olunur."), outcome.activationBlockers.join(" | "));
  assert.equal(outcome.products?.published.length, 0);
  assert.equal(world.products[0].status, "DRAFT");
  assert.equal(world.grants.length, 0);
  assert.equal(isPublicStoreEligible(world.publicCandidate()), false);
});

test("(c) approved WITH a free grant and no subscription: goes live, draft published, publicly eligible", async () => {
  const world = fakeWorld();
  const outcome = await runStoreReviewTransaction(world.tx, {
    storeId: world.store.id, adminId: "admin-1", action: "approve",
    freeGrant: { tier: "BASIC", endsAt: null, reason: "Pilot mağaza – ödənişsiz qoşulma" },
  });
  assert.equal(outcome.kind, "UPDATED");
  if (outcome.kind !== "UPDATED") return;
  assert.deepEqual(outcome.activationBlockers, []);
  assert.equal(world.store.status, "ACTIVE");
  assert.equal(world.store.isActive, true);
  assert.equal(world.store.legalInfoApproved, true);
  assert.equal(outcome.freeGrantTier, "BASIC");
  assert.equal(world.grants.length, 1);
  assert.equal(world.grants[0].endsAt, null);
  assert.deepEqual(outcome.products?.published.map((p) => p.id), ["p-ready"]);
  assert.equal(world.products[0].status, "ACTIVE");
  assert.ok(world.audits.some((a) => a.action === "ADMIN_COMPLIMENTARY_GRANT"));
  assert.equal(isPublicStoreEligible(world.publicCandidate()), true);
});

test("(d) the store-list approve button links to the store page and never posts /review for approval", () => {
  const source = read("components/admin-store-activation-action.tsx");
  assert.doesNotMatch(source, /review\("approve"\)/);
  assert.doesNotMatch(source, /action: "approve"|"approve" \|/);
  assert.match(source, /import Link from "next\/link";/);
  assert.match(source, /<Link href=\{`\/admin\/stores\/\$\{encodeURIComponent\(storeId\)\}`\}[^>]*>Hüquqi baxışdan sonra təsdiqlə<\/Link>/);
  // Same condition as before for showing it.
  assert.match(source, /\(status === "PENDING_REVIEW" \|\| \(status === "ACTIVE" && !legalInfoApproved\)\) && <Link /);
  // Reactivate unchanged: still posts /review with action "reactivate".
  assert.match(source, /onClick=\{\(\) => void review\("reactivate"\)\}[^>]*>Hüquqi baxışdan sonra bərpa et<\/button>/);
  assert.match(source, /\/api\/admin\/stores\/\$\{encodeURIComponent\(storeId\)\}\/review/);
  assert.match(source, /body: JSON\.stringify\(\{ action \}\)/);
  assert.match(source, /async function review\(action: "reactivate"\)/);
  // The store page keeps the approval form with the free-sale option.
  assert.match(read("components/admin-store-review-actions.tsx"), /Ödənişsiz satış \(admin icazəsi\)/);
  // All three admin pages use this one component.
  for (const page of ["app/admin/_sections/stores.tsx", "app/admin/_sections/subscriptions.tsx", "app/admin/_sections/shared.tsx"]) {
    assert.match(read(page), /<AdminStoreActivationAction storeId=/, page);
  }
});

test("(d) no new visible text and no legal page change", () => {
  // Every Azerbaijani-looking string in the changed files already existed at BASE (texts may only be removed).
  const AZ = /[əƏğĞıİöÖüÜşŞçÇ]/;
  const texts = (source: string) => new Set((source.match(/"[^"\n]*"|`[^`\n]*`|>[^<>{}\n]+</g) ?? []).map((t) => t.slice(1, -1).trim()).filter((t) => AZ.test(t)));
  for (const path of ["components/admin-store-activation-action.tsx", "lib/store-submission.ts"]) {
    const before = texts(git("show", `${BASE}:${path}`).replace(/\r\n/g, "\n"));
    const added = [...texts(atTask(path))].filter((t) => !before.has(t));
    assert.deepEqual(added, [], path);
  }
  assert.equal(diffNames("app/(customer)/terms", "app/(customer)/privacy", "app/(customer)/seller-terms", "app/(customer)/delivery-returns", "lib/legal-versions.ts", "lib/legal-acceptance.ts", "prisma", "package.json", "package-lock.json"), "");
});
