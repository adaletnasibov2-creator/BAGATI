/**
 * lib/legal-acceptance.ts with an in-memory fake client (no database). The real-database behaviour (unique index,
 * Cascade, SetNull) is covered by scripts/legal-acceptance.integration.test.ts on the verify cluster.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { LegalAcceptanceSource, LegalDocument, Prisma, PrismaClient } from "@prisma/client";
import { hasAcceptedCurrent, LEGAL_TERMS_ACCEPTED, recordAcceptance, type LegalAcceptanceReader, type LegalAcceptanceWriter } from "../lib/legal-acceptance";
import { LEGAL_VERSIONS } from "../lib/legal-versions";

// Compile-time: the real clients satisfy the narrow types (checked by `npm run typecheck`).
export const realClientsFit = (client: PrismaClient, tx: Prisma.TransactionClient): [LegalAcceptanceReader, LegalAcceptanceWriter, LegalAcceptanceWriter] => [client, client, tx];

type Row = { id: string; userId: string; document: LegalDocument; version: string; source: LegalAcceptanceSource; vendorApplicationId: string | null };

function fakeDb() {
  const rows: Row[] = [];
  const audits: { actorId: string; action: string; entityType: string; entityId: string; metadata: Record<string, unknown> }[] = [];
  const calls: string[] = [];
  const db: LegalAcceptanceWriter = {
    legalAcceptance: {
      async findUnique({ where }) {
        calls.push("findUnique");
        const key = where.userId_document_version;
        const row = rows.find((r) => r.userId === key.userId && r.document === key.document && r.version === key.version);
        return row ? { id: row.id } : null;
      },
      async createMany({ data, skipDuplicates }) {
        calls.push("createMany");
        assert.equal(skipDuplicates, true, "always ON CONFLICT DO NOTHING");
        let count = 0;
        for (const item of data) {
          if (rows.some((r) => r.userId === item.userId && r.document === item.document && r.version === item.version)) continue;
          rows.push({ id: `row${rows.length + 1}`, ...item });
          count++;
        }
        return { count };
      },
    },
    auditLog: {
      async create({ data }) { calls.push("auditLog.create"); audits.push(data); return data; },
    },
  };
  return { db, rows, audits, calls };
}

test("first acceptance inserts one row for the current version and one audit row with document, version and source only", async () => {
  const { db, rows, audits } = fakeDb();
  const result = await recordAcceptance(db, { userId: "u1", document: "CUSTOMER_TERMS", source: "REGISTER_EMAIL" });
  assert.deepEqual(result, { created: true, version: LEGAL_VERSIONS.CUSTOMER_TERMS });
  assert.deepEqual(rows, [{ id: "row1", userId: "u1", document: "CUSTOMER_TERMS", version: "2026-11-17", source: "REGISTER_EMAIL", vendorApplicationId: null }]);
  assert.deepEqual(audits, [{
    actorId: "u1", action: LEGAL_TERMS_ACCEPTED, entityType: "LegalAcceptance", entityId: "row1",
    metadata: { document: "CUSTOMER_TERMS", version: "2026-11-17", source: "REGISTER_EMAIL" },
  }]);
  assert.deepEqual(Object.keys(audits[0].metadata).sort(), ["document", "source", "version"], "no personal data in metadata");
});

test("a repeat acceptance of the same version inserts nothing and writes no audit row", async () => {
  const { db, rows, audits, calls } = fakeDb();
  await recordAcceptance(db, { userId: "u1", document: "SELLER_TERMS", source: "SELLER_PANEL" });
  calls.length = 0;
  const again = await recordAcceptance(db, { userId: "u1", document: "SELLER_TERMS", source: "SELLER_APPLICATION" });
  assert.deepEqual(again, { created: false, version: LEGAL_VERSIONS.SELLER_TERMS });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "SELLER_PANEL", "the first acceptance is kept unchanged");
  assert.equal(audits.length, 1);
  assert.deepEqual(calls, ["createMany"]);
});

test("the documents are independent; the seller application id is stored with SELLER_TERMS", async () => {
  const { db, rows } = fakeDb();
  await recordAcceptance(db, { userId: "u1", document: "CUSTOMER_TERMS", source: "CHECKOUT" });
  await recordAcceptance(db, { userId: "u1", document: "SELLER_TERMS", source: "SELLER_APPLICATION", vendorApplicationId: "app1" });
  assert.deepEqual(rows.map((r) => [r.document, r.version, r.vendorApplicationId]), [["CUSTOMER_TERMS", "2026-11-17", null], ["SELLER_TERMS", "2026-11-18", "app1"]]);
});

test("refuses a missing user id and an application id on customer terms (nothing written)", async () => {
  const { db, rows, audits } = fakeDb();
  await assert.rejects(recordAcceptance(db, { userId: "", document: "CUSTOMER_TERMS", source: "CHECKOUT" }), /userId is required/);
  await assert.rejects(recordAcceptance(db, { userId: "u1", document: "CUSTOMER_TERMS", source: "CHECKOUT", vendorApplicationId: "app1" }), /SELLER_TERMS only/);
  assert.equal(rows.length + audits.length, 0);
});

test("hasAcceptedCurrent: only the current version counts", async () => {
  const { db, rows } = fakeDb();
  assert.equal(await hasAcceptedCurrent(db, "u1", "CUSTOMER_TERMS"), false);
  rows.push({ id: "old", userId: "u1", document: "CUSTOMER_TERMS", version: "2026-01-01", source: "REGISTER_EMAIL", vendorApplicationId: null });
  assert.equal(await hasAcceptedCurrent(db, "u1", "CUSTOMER_TERMS"), false, "an older version does not count");
  await recordAcceptance(db, { userId: "u1", document: "CUSTOMER_TERMS", source: "CHECKOUT" });
  assert.equal(await hasAcceptedCurrent(db, "u1", "CUSTOMER_TERMS"), true);
  assert.equal(await hasAcceptedCurrent(db, "u1", "SELLER_TERMS"), false);
  assert.equal(await hasAcceptedCurrent(db, "u2", "CUSTOMER_TERMS"), false);
  assert.equal(await hasAcceptedCurrent(db, "", "CUSTOMER_TERMS"), false);
});

test("Phase B: exactly the expected application code calls the helper (registration, Google, checkout, seller gates)", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = join(__dirname, "..");
  const callers: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(root, dir))) {
      const path = `${dir}/${name}`;
      if (statSync(join(root, path)).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name) && path !== "lib/legal-acceptance.ts" && /(from\s+|import\(\s*)["'][^"']*\/legal-acceptance["']/.test(readFileSync(join(root, path), "utf8"))) callers.push(path);
    }
  };
  for (const dir of ["app", "components", "lib"]) walk(dir);
  // A new caller must be added here on purpose (and recorded in the legal-acceptance report).
  assert.deepEqual(callers.sort(), [
    "app/(customer)/checkout/page.tsx",
    "app/api/auth/google/callback/route.ts",
    "app/api/auth/register/route.ts",
    "app/api/vendor/[storeId]/[section]/route.ts",
    "app/vendor/[storeId]/layout.tsx",
    "app/vendor/page.tsx",
    "app/vendor/stores/new/page.tsx",
    "lib/legal-gates.ts",
    "lib/seller-application-service.ts",
    "lib/vendor-product-patch.ts",
  ]);
});
