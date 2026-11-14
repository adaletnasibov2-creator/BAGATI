/**
 * lib/admin-labels.ts: every status enum value has an Azerbaijani label and a badge tone. No database.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ImportStatus, OrderStatus, PaymentStatus, ProductStatus, ReturnStatus, StoreStatus, SubscriptionStatus, TicketStatus, VendorApplicationStatus } from "@prisma/client";
import { ADMIN_STATUS_LABELS, adminStatusLabel, adminStatusOptions, adminStatusTone, type AdminStatusKind } from "../lib/admin-labels";

const ENUMS: Record<AdminStatusKind, Record<string, string>> = {
  store: StoreStatus,
  product: ProductStatus,
  order: OrderStatus,
  subscription: SubscriptionStatus,
  support: TicketStatus,
  sellerApplication: VendorApplicationStatus,
  payment: PaymentStatus,
  return: ReturnStatus,
  import: ImportStatus,
};

test("every value of every status enum has an Azerbaijani label and a tone; no label for a value that does not exist", () => {
  assert.deepEqual(Object.keys(ADMIN_STATUS_LABELS).sort(), Object.keys(ENUMS).sort());
  for (const [kind, values] of Object.entries(ENUMS) as [AdminStatusKind, Record<string, string>][]) {
    const enumValues = Object.values(values).sort();
    assert.deepEqual(Object.keys(ADMIN_STATUS_LABELS[kind]).sort(), enumValues, `${kind}: labels cover exactly the enum`);
    for (const value of enumValues) {
      const label = adminStatusLabel(kind, value);
      assert.notEqual(label, value, `${kind}.${value} is translated`);
      assert.doesNotMatch(label, /^[A-Z_]+$/, `${kind}.${value} is not an enum name`);
      assert.ok(["neutral", "info", "success", "warning", "danger", "accent"].includes(adminStatusTone(kind, value)));
    }
  }
});

test("labels are distinct within a kind, so filters stay unambiguous", () => {
  for (const kind of Object.keys(ADMIN_STATUS_LABELS) as AdminStatusKind[]) {
    const labels = Object.values(ADMIN_STATUS_LABELS[kind]).map(([label]) => label);
    assert.equal(new Set(labels).size, labels.length, kind);
  }
});

test("known wording and safe fallbacks", () => {
  assert.equal(adminStatusLabel("store", "PENDING_REVIEW"), "Yoxlama gözləyir");
  assert.equal(adminStatusLabel("order", "PREPARING"), "Hazırlanır");
  assert.equal(adminStatusLabel("order", "PROCESSING"), "Emal olunur");
  assert.equal(adminStatusLabel("sellerApplication", "PENDING"), "Yoxlanılır");
  assert.equal(adminStatusLabel("order", "SOMETHING_NEW"), "SOMETHING_NEW", "an unknown value is shown, not hidden");
  assert.equal(adminStatusLabel("order", null), "—");
  assert.equal(adminStatusTone("order", "SOMETHING_NEW"), "neutral");
  assert.equal(adminStatusTone("store", "ACTIVE"), "success");
});

test("filter options keep the raw value as the URL value and show the label", () => {
  assert.deepEqual(adminStatusOptions("product", ["DRAFT", "ACTIVE"]), [{ id: "DRAFT", name: "Qaralama" }, { id: "ACTIVE", name: "Aktiv" }]);
});

test("admin pages show labels, not raw status values, in selects and status cells", () => {
  const dir = join(__dirname, "..", "app/admin/_sections");
  const files = [...readdirSync(dir).map((name) => join(dir, name)), join(__dirname, "..", "app/admin/page.tsx")];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\.map\(s=>\(\{id:s,name:s\}\)\)/, `${file}: filter options use adminStatusOptions`);
    assert.doesNotMatch(source, /\(\{value:s,label:s\}\)/, `${file}: status form options use labels`);
    assert.doesNotMatch(source, /cell:r=>r\.status\}/, `${file}: status cells use AdminStatusBadge`);
  }
  // Filter values stay the raw enum (URLs like ?status=PENDING_REVIEW keep working).
  assert.match(readFileSync(join(dir, "stores.tsx"), "utf8"), /normalizeAdminEnumFilter\(sp\.status,storeStatuses\)/);
});
