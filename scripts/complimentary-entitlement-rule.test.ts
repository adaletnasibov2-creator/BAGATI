import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { isPublicStoreEligible, type PublicStoreCandidate } from "../lib/public-store-eligibility";
import { publicStoreWhere } from "../lib/seller-legal-policy";
import {
  activeComplimentaryEntitlementSelect,
  complimentaryFromRows,
  planEntitlements,
  resolveStoreEntitlements,
  type StoreEntitlementState,
} from "../lib/subscription-entitlements";

const NOW = new Date("2026-11-12T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const noSubscription: StoreEntitlementState = {
  adminManaged: false, storeStatus: "ACTIVE", storeActive: true, vendorActive: true, cityActive: true,
  subscriptionStatus: null, planSlug: null, planActive: false, periodStart: null, periodEnd: null, complimentary: null,
};
const paidBasic: StoreEntitlementState = { ...noSubscription, subscriptionStatus: "ACTIVE", planSlug: "basic", planActive: true, periodEnd: new Date(NOW.getTime() + 10 * DAY) };

test("path (1) unchanged: no grant and no paid subscription does not sell; a current paid subscription sells", () => {
  assert.deepEqual(resolveStoreEntitlements(noSubscription, NOW), { eligible: false, plan: null, limits: null });
  for (const status of ["PENDING", "PAST_DUE", "SUSPENDED", "CANCELLED", "EXPIRED"]) {
    assert.equal(resolveStoreEntitlements({ ...paidBasic, subscriptionStatus: status }, NOW).eligible, false, status);
  }
  assert.equal(resolveStoreEntitlements({ ...paidBasic, periodEnd: new Date(NOW.getTime() - 1) }, NOW).eligible, false);
  const paid = resolveStoreEntitlements(paidBasic, NOW);
  assert.equal(paid.eligible, true);
  assert.equal(paid.plan, "BASIC");
  assert.equal(resolveStoreEntitlements({ ...paidBasic, planSlug: "professional" }, NOW).plan, "PRO");
});

test("a current complimentary grant sells at its tier with that tier's limits", () => {
  const basic = resolveStoreEntitlements({ ...noSubscription, complimentary: { tier: "BASIC", endsAt: null } }, NOW);
  assert.equal(basic.eligible, true);
  assert.equal(basic.plan, "BASIC");
  assert.equal(basic.limits?.activeProducts, 300);
  const pro = resolveStoreEntitlements({ ...noSubscription, complimentary: { tier: "PRO", endsAt: new Date(NOW.getTime() + DAY) } }, NOW);
  assert.equal(pro.plan, "PRO");
  assert.equal(pro.limits, planEntitlements.PRO);
});

test("an ended grant stops selling; the end date is exclusive", () => {
  assert.equal(resolveStoreEntitlements({ ...noSubscription, complimentary: { tier: "BASIC", endsAt: new Date(NOW.getTime() - 1) } }, NOW).eligible, false);
  assert.equal(resolveStoreEntitlements({ ...noSubscription, complimentary: { tier: "BASIC", endsAt: NOW } }, NOW).eligible, false);
  assert.equal(resolveStoreEntitlements({ ...noSubscription, complimentary: { tier: "BASIC", endsAt: new Date(NOW.getTime() + 1) } }, NOW).eligible, true);
});

test("a grant never bypasses the base checks", () => {
  const grant = { tier: "PRO" as const, endsAt: null };
  for (const override of [{ storeStatus: "SUSPENDED" }, { storeStatus: "PENDING_REVIEW" }, { storeActive: false }, { vendorActive: false }, { cityActive: false }]) {
    assert.equal(resolveStoreEntitlements({ ...noSubscription, ...override, complimentary: grant }, NOW).eligible, false, JSON.stringify(override));
  }
});

test("a current paid subscription takes precedence over the grant tier", () => {
  assert.equal(resolveStoreEntitlements({ ...paidBasic, complimentary: { tier: "PRO", endsAt: null } }, NOW).plan, "BASIC");
  assert.equal(resolveStoreEntitlements({ ...paidBasic, subscriptionStatus: "EXPIRED", complimentary: { tier: "PRO", endsAt: null } }, NOW).plan, "PRO");
});

test("admin-managed stores keep BASIC unless a grant gives a tier", () => {
  assert.equal(resolveStoreEntitlements({ ...noSubscription, adminManaged: true }, NOW).plan, "BASIC");
  assert.equal(resolveStoreEntitlements({ ...noSubscription, adminManaged: true, complimentary: { tier: "PRO", endsAt: null } }, NOW).plan, "PRO");
});

test("complimentaryFromRows accepts only the loaded unrevoked row with a known tier", () => {
  assert.equal(complimentaryFromRows(undefined), null);
  assert.equal(complimentaryFromRows([]), null);
  assert.equal(complimentaryFromRows([{ tier: "GOLD", endsAt: null }]), null);
  assert.deepEqual(complimentaryFromRows([{ tier: "PRO", endsAt: null }]), { tier: "PRO", endsAt: null });
});

// ---------------------------------------------------------------------------------------------
// Parity: the SQL filter (publicStoreWhere / publicStoreEligibilityBaseWhere) and the JS rule
// (isPublicStoreEligible -> resolveStoreEntitlements) must agree on every case below.
// The evaluator implements exactly the Prisma where operators these filters use.
// ---------------------------------------------------------------------------------------------

type Row = Record<string, unknown>;
const SCALAR_OPS = new Set(["not", "gt", "gte", "lt", "lte", "in", "equals", "mode"]);
const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !(value instanceof Date) && !Array.isArray(value);
const comparable = (value: unknown) => value instanceof Date ? value.getTime() : value;

function matchScalar(value: unknown, filter: Record<string, unknown>): boolean {
  const insensitive = filter.mode === "insensitive";
  const norm = (v: unknown) => insensitive && typeof v === "string" ? v.toLowerCase() : comparable(v);
  for (const [op, operand] of Object.entries(filter)) {
    if (op === "mode") continue;
    if (op === "not") { if (operand === null ? value === null : value === null || norm(value) === norm(operand)) return false; continue; }
    if (value === null || value === undefined) return false;
    const left = norm(value);
    const right = norm(operand);
    if (op === "equals" && left !== right) return false;
    if (op === "in" && !(operand as unknown[]).map(norm).includes(left)) return false;
    if (op === "gt" && !((left as number) > (right as number))) return false;
    if (op === "gte" && !((left as number) >= (right as number))) return false;
    if (op === "lt" && !((left as number) < (right as number))) return false;
    if (op === "lte" && !((left as number) <= (right as number))) return false;
  }
  return true;
}

function matches(row: Row | null | undefined, where: Record<string, unknown>): boolean {
  if (!row) return false;
  for (const [key, condition] of Object.entries(where)) {
    if (key === "AND") { if (!(condition as Record<string, unknown>[]).every((part) => matches(row, part))) return false; continue; }
    if (key === "OR") { if (!(condition as Record<string, unknown>[]).some((part) => matches(row, part))) return false; continue; }
    const value = row[key];
    if (condition === null) { if (value !== null) return false; continue; }
    if (!isPlainObject(condition)) { if (comparable(value) !== comparable(condition)) return false; continue; }
    if (Array.isArray(value)) {
      if ("some" in condition) { if (!value.some((item) => matches(item as Row, condition.some as Record<string, unknown>))) return false; continue; }
      throw new Error(`unsupported list filter on ${key}`);
    }
    if (Object.keys(condition).every((op) => SCALAR_OPS.has(op)) && !isPlainObject(value)) { if (!matchScalar(value, condition)) return false; continue; }
    const relation = "is" in condition ? condition.is as Record<string, unknown> : condition;
    if (!matches(value as Row | null, relation)) return false;
  }
  return true;
}

type Grant = { tier: "BASIC" | "PRO"; endsAt: Date | null; revokedAt: Date | null };
const subscriptions: Array<Row | null> = [
  null,
  { status: "ACTIVE", currentPeriodStart: null, currentPeriodEnd: new Date(NOW.getTime() + DAY), plan: { isActive: true, slug: "basic" } },
  { status: "ACTIVE", currentPeriodStart: new Date(NOW.getTime() - DAY), currentPeriodEnd: null, plan: { isActive: true, slug: "Professional" } },
  { status: "ACTIVE", currentPeriodStart: null, currentPeriodEnd: new Date(NOW.getTime() - 1), plan: { isActive: true, slug: "basic" } },
  { status: "ACTIVE", currentPeriodStart: new Date(NOW.getTime() + DAY), currentPeriodEnd: null, plan: { isActive: true, slug: "basic" } },
  { status: "ACTIVE", currentPeriodStart: null, currentPeriodEnd: null, plan: { isActive: false, slug: "basic" } },
  { status: "ACTIVE", currentPeriodStart: null, currentPeriodEnd: null, plan: { isActive: true, slug: "enterprise" } },
  { status: "PENDING", currentPeriodStart: null, currentPeriodEnd: null, plan: { isActive: true, slug: "basic" } },
];
const grantSets: Grant[][] = [
  [],
  [{ tier: "BASIC", endsAt: null, revokedAt: null }],
  [{ tier: "PRO", endsAt: new Date(NOW.getTime() + DAY), revokedAt: null }],
  [{ tier: "BASIC", endsAt: new Date(NOW.getTime() - 1), revokedAt: null }],
  [{ tier: "BASIC", endsAt: NOW, revokedAt: null }],
  [{ tier: "PRO", endsAt: null, revokedAt: new Date(NOW.getTime() - DAY) }],
  [{ tier: "PRO", endsAt: null, revokedAt: new Date(NOW.getTime() - DAY) }, { tier: "BASIC", endsAt: null, revokedAt: null }],
];

test("parity: the SQL filter and the JS rule agree on every combination", () => {
  const where = publicStoreWhere(NOW) as Record<string, unknown>;
  const activeGrantWhere = activeComplimentaryEntitlementSelect.where as Record<string, unknown>;
  let checked = 0;
  let sellable = 0;
  for (const isActive of [true, false])
    for (const status of ["ACTIVE", "SUSPENDED"])
      for (const legalInfoApproved of [true, false])
        for (const cityActive of [true, false])
          for (const vendorActive of [true, false])
            for (const adminManaged of [false, true])
              for (const voen of ["1234567890", null])
                for (const subscription of subscriptions)
                  for (const grants of grantSets) {
                    const record: Row = {
                      isActive, status, legalInfoApproved, adminManaged,
                      city: { isActive: cityActive },
                      vendor: { user: { isActive: vendorActive }, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: "Seller", voen, legalAddress: null },
                      subscription,
                      complimentaryEntitlements: grants,
                    };
                    const candidate = {
                      id: `case-${checked}`, status, isActive, legalInfoApproved, adminManaged,
                      city: { isActive: cityActive },
                      vendor: { user: { isActive: vendorActive }, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: "Seller", voen, legalAddress: null },
                      subscription: subscription as PublicStoreCandidate["subscription"],
                      // What activeComplimentaryEntitlementSelect loads: unrevoked rows only.
                      complimentaryEntitlements: grants.filter((grant) => matches(grant as unknown as Row, activeGrantWhere)),
                    } satisfies PublicStoreCandidate;
                    const sql = matches(record, where);
                    const js = isPublicStoreEligible(candidate, NOW);
                    assert.equal(sql, js, `SQL=${sql} JS=${js} for ${JSON.stringify(record)}`);
                    checked += 1;
                    if (js) sellable += 1;
                  }
  assert.equal(checked, 2 ** 7 * subscriptions.length * grantSets.length);
  assert.ok(sellable > 0);
});

test("parity evaluator self-check: it rejects and accepts the obvious cases", () => {
  assert.equal(matches({ a: 1 }, { a: 1 }), true);
  assert.equal(matches({ a: 1 }, { a: 2 }), false);
  assert.equal(matches({ d: new Date(5) }, { d: { gt: new Date(4) } }), true);
  assert.equal(matches({ d: null }, { d: { gt: new Date(4) } }), false);
  assert.equal(matches({ r: null }, { r: { is: { a: 1 } } }), false);
  assert.equal(matches({ list: [{ a: 1 }, { a: 2 }] }, { list: { some: { a: 2 } } }), true);
  assert.equal(matches({ s: "PRO" }, { s: { in: ["pro"], mode: "insensitive" } }), true);
});

// ---------------------------------------------------------------------------------------------
// Static guards
// ---------------------------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const appSources = ["app", "lib", "components"].flatMap(sourceFiles).map((path) => ({ path: path.replace(/\\/g, "/"), text: readFileSync(path, "utf8") }));
const RULE_CALL = /\b(resolveStoreEntitlements|isPublicStoreEligible|getStorePublicationBlockers|checkVendorProductActivation|buildAdminStoreReadiness|isProBadgeEligible)\(/;

test("every caller of the sell rule also passes the complimentary grant", () => {
  const callers = appSources.filter(({ text }) => RULE_CALL.test(text));
  assert.ok(callers.length >= 10, `expected many callers, found ${callers.length}`);
  for (const { path, text } of callers) {
    assert.match(text, /complimentary/i, `${path} uses the sell rule but never loads or passes the complimentary grant`);
  }
});

test("only lib/complimentary-entitlements.ts writes complimentary grant rows", () => {
  const writers = appSources.filter(({ text }) => /storeComplimentaryEntitlement\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(text));
  for (const { path } of writers) assert.equal(path, "lib/complimentary-entitlements.ts", `${path} writes grant rows directly`);
});

test("the SQL filter carries the complimentary branch next to the paid-subscription branch", () => {
  const branches = (publicStoreWhere(NOW).OR ?? []) as Record<string, unknown>[];
  assert.ok(branches.some((branch) => "complimentaryEntitlements" in branch));
  assert.ok(branches.some((branch) => "subscription" in branch));
  assert.ok(branches.some((branch) => "adminManaged" in branch));
});
