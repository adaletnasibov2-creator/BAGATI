/**
 * Admin Phase A fixes: store profile form (owner/city prefill, no silent owner/city change, plain props), dashboard
 * pending-orders link, list filters keep their values, dead subscriptions branch removed, verification in the nav.
 * No database.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Prisma } from "@prisma/client";
import {
  planStoreProfileUpdate, storeProfileChangeConfirmation, storeProfileOptions, toAdminStoreProfileView,
} from "../lib/admin-store-profile";
import { ADMIN_PENDING_ORDER_GROUP, ADMIN_PENDING_ORDER_STATUSES, ADMIN_PENDING_ORDERS_HREF, adminOrderStatusWhere } from "../lib/admin-order-filters";
import { Filters, FilterSelect } from "../components/admin-list-filters";

// tsx compiles the components' JSX with the classic runtime, which needs a global React (as in store-public-contact.test.ts).
(globalThis as { React?: typeof React }).React = React;

const root = join(__dirname, "..");
// Line endings normalised: with core.autocrlf=true a checkout has CRLF, and the patterns below use "\n".
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const sectionPage = read("app/admin/[...section]/page.tsx");
const adminRoute = read("app/api/admin/[...resource]/route.ts");

// ---------------------------------------------------------------------------------------------------------------
// 1. Store profile form: current owner and city are shown; saving never silently changes them
// ---------------------------------------------------------------------------------------------------------------

test("options always contain the store's current owner and city, even when inactive", () => {
  const active = [{ id: "c1", name: "Bakı" }, { id: "c2", name: "Gəncə" }];
  assert.deepEqual(storeProfileOptions(active, { id: "c1", name: "Bakı" }), [{ value: "c1", label: "Bakı" }, { value: "c2", label: "Gəncə" }], "active current value: not duplicated");
  assert.deepEqual(storeProfileOptions(active, { id: "c9", name: "Qazax" })[0], { value: "c9", label: "Qazax (deaktiv)" }, "inactive current value is kept (first), marked");
  assert.equal(storeProfileOptions(active, null).length, 2);
});

test("the form gets its options from the server with the page (no late client fetch) and sends what it showed", () => {
  const form = read("components/admin-store-profile-form.tsx");
  assert.doesNotMatch(form, /fetch\(|useEffect|useState/, "no late-loading options");
  assert.match(form, /\{ name: "vendorId", label: "Satıcı sahibi", type: "select", value: store\.vendorId, required: true, options: vendorOptions \}/);
  assert.match(form, /\{ name: "cityId", label: "Şəhər", type: "select", value: store\.cityId, required: true, options: cityOptions \}/);
  assert.match(form, /\{ name: "expectedVendorId", label: "", type: "hidden", value: store\.vendorId \}/);
  assert.match(form, /\{ name: "expectedCityId", label: "", type: "hidden", value: store\.cityId \}/);
  assert.match(form, /confirmWhen=\{\(payload\) => storeProfileChangeConfirmation\(store, payload/);
  assert.match(sectionPage, /<AdminStoreProfileForm store=\{toAdminStoreProfileView\(store\)\} vendorOptions=\{vendorOptions\} cityOptions=\{cityOptions\}\/>/);
  assert.match(sectionPage, /const vendorOptions=storeProfileOptions\(/);
  assert.match(sectionPage, /const cityOptions=storeProfileOptions\(activeCities,store\.city\?\{id:store\.cityId,name:store\.city\.name\}:null\)/);
  const mutationForm = read("components/admin-mutation-form.tsx");
  // Phase B: the confirmation uses the accessible ConfirmDialog instead of window.confirm (same behaviour).
  assert.match(mutationForm, /const dynamicConfirm=confirmWhen\?\.\(payload\);\s*if\(dynamicConfirm&&!\(await confirm\(\{message:dynamicConfirm\}\)\)\)\{setBusy\(false\);return;\}/);
});

test("changing owner or city asks for confirmation naming both values; an unchanged save asks nothing", () => {
  const labels = { vendor: (id: string) => ({ v1: "Satıcı A", v2: "Satıcı B" })[id] ?? id, city: (id: string) => ({ c1: "Bakı", c2: "Gəncə" })[id] ?? id };
  const initial = { vendorId: "v1", cityId: "c1" };
  assert.equal(storeProfileChangeConfirmation(initial, { vendorId: "v1", cityId: "c1", name: "Yeni ad" }, labels), null);
  const owner = storeProfileChangeConfirmation(initial, { vendorId: "v2", cityId: "c1" }, labels);
  assert.match(owner ?? "", /Satıcı sahibi dəyişəcək: Satıcı A → Satıcı B\. Hüquqi yoxlama yenidən tələb olunacaq\./);
  assert.doesNotMatch(owner ?? "", /Şəhər/);
  assert.match(storeProfileChangeConfirmation(initial, { vendorId: "v1", cityId: "c2" }, labels) ?? "", /Şəhər dəyişəcək: Bakı → Gəncə\./);
});

test("server rule: owner/city change only when different; stale form refused", () => {
  const current = { vendorId: "v1", cityId: "c1" };
  assert.deepEqual(planStoreProfileUpdate(current, { vendorId: "v1", cityId: "c1", expectedVendorId: "v1", expectedCityId: "c1" }), { ok: true, ownerChanged: false, cityChanged: false }, "unchanged values are no change");
  assert.deepEqual(planStoreProfileUpdate(current, { vendorId: "v2", cityId: "c1", expectedVendorId: "v1", expectedCityId: "c1" }), { ok: true, ownerChanged: true, cityChanged: false, vendorId: "v2" });
  assert.deepEqual(planStoreProfileUpdate(current, { cityId: "c2" }), { ok: true, ownerChanged: false, cityChanged: true, cityId: "c2" }, "older clients without expected values still work");
  assert.deepEqual(planStoreProfileUpdate(current, { vendorId: "v1", expectedVendorId: "v0" }), { ok: false, reason: "STALE" }, "owner changed meanwhile");
  assert.deepEqual(planStoreProfileUpdate(current, { cityId: "c1", expectedCityId: "c0" }), { ok: false, reason: "STALE" }, "city changed meanwhile");
  assert.deepEqual(planStoreProfileUpdate(current, { vendorId: "" }), { ok: true, ownerChanged: false, cityChanged: false }, "an empty value never changes the owner");
});

test("store PATCH: legal re-review and STORE_OWNER_CHANGE only on a real owner change; stale save is 409", () => {
  const handler = adminRoute.split('if (section === "stores") {\n      if (body && typeof body === "object" && "status" in body)')[1]?.split('\n    if (section === "commissions")')[0] ?? "";
  assert.ok(handler.length > 500, "found the store PATCH handler");
  assert.match(handler, /const plan = planStoreProfileUpdate\(currentStore, \{ vendorId: requestedVendorId, cityId: requestedCityId, expectedVendorId, expectedCityId \}\);/);
  assert.match(handler, /if \(!plan\.ok\) return NextResponse\.json\(\{ error: "[^"]+" \}, \{ status: 409 \}\);/);
  assert.match(handler, /const \{ vendorId, cityId \} = plan;/);
  assert.match(handler, /data: \{ \.\.\.values, \.\.\.\(cityId \? \{ cityId \} : \{\}\), \.\.\.\(vendorId \? \{ vendorId, legalInfoApproved: false \} : \{\}\) \}/);
  assert.match(handler, /where: \{ id: storeId, vendorId: currentStore\.vendorId, cityId: currentStore\.cityId \}/, "conditional update: no lost write");
  assert.match(handler, /action: vendorId \? "STORE_OWNER_CHANGE" : "UPDATE"/);
  assert.doesNotMatch(handler, /requestedVendorId \? \{ vendorId: requestedVendorId/, "the raw submitted owner is never written");
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Plain values for the client component
// ---------------------------------------------------------------------------------------------------------------

test("the store view passed to the client form holds only plain values (Decimal → number)", () => {
  const view = toAdminStoreProfileView({
    id: "s1", name: "Mağaza", vendorId: "v1", cityId: "c1", status: "ACTIVE", legalInfoApproved: true,
    freeDeliveryThreshold: new Prisma.Decimal("30.00"), deliveryFee: new Prisma.Decimal("2.50"), latitude: 40.4093, longitude: null,
    vendor: { sellerType: "REGISTERED_COMPANY", legalName: "MMC", voen: "1234567890", legalAddress: null },
    complimentaryEntitlements: [{ revokedAt: new Date() }, { revokedAt: null }],
    ...({ products: [{ price: new Prisma.Decimal("9.99") }], createdAt: new Date() } as object),
  } as Parameters<typeof toAdminStoreProfileView>[0]);
  assert.equal(view.freeDeliveryThreshold, 30);
  assert.equal(view.deliveryFee, 2.5);
  assert.equal(view.latitude, 40.4093);
  assert.equal(view.longitude, null);
  assert.equal(view.hasActiveGrant, true);
  assert.equal("products" in view || "createdAt" in view, false, "nested records are not passed");
  for (const [key, value] of Object.entries(view)) {
    assert.ok(value === null || ["string", "number", "boolean"].includes(typeof value), `${key} is a plain value`);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(view)), view, "serialisable without loss");
});

// ---------------------------------------------------------------------------------------------------------------
// 3. Dashboard "Gözləyən sifarişlər": the link shows what the card counts
// ---------------------------------------------------------------------------------------------------------------

test("dashboard pending orders: count and link use the same status group", () => {
  const dashboard = read("app/admin/page.tsx");
  assert.match(dashboard, /db\.order\.count\(\{where:\{status:\{in:\[\.\.\.ADMIN_PENDING_ORDER_STATUSES\]\}\}\}\)/);
  assert.match(dashboard, /\["Gözləyən sifarişlər",pendingOrders,ADMIN_PENDING_ORDERS_HREF\]/);
  assert.doesNotMatch(dashboard, /orders\?status=PENDING"/);
  assert.equal(ADMIN_PENDING_ORDERS_HREF, "/admin/orders?status=pending");
  const statuses = ["PENDING", "NEW", "CONFIRMED", "PREPARING", "READY", "HANDED_TO_COURIER", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED"];
  assert.deepEqual(adminOrderStatusWhere(ADMIN_PENDING_ORDER_GROUP, statuses), { status: { in: [...ADMIN_PENDING_ORDER_STATUSES] } });
  assert.deepEqual([...ADMIN_PENDING_ORDER_STATUSES], ["PENDING", "NEW", "CONFIRMED", "PREPARING", "READY", "PROCESSING"], "same six statuses as before");
  assert.deepEqual(adminOrderStatusWhere("SHIPPED", statuses), { status: "SHIPPED" });
  assert.deepEqual(adminOrderStatusWhere("bogus", statuses), {});
  assert.deepEqual(adminOrderStatusWhere(undefined, statuses), {});
  assert.match(sectionPage, /const where:any=\{\.\.\.adminOrderStatusWhere\(sp\.status,orderStatuses\),/);
  assert.match(sectionPage, /values=\{\[\{id:ADMIN_PENDING_ORDER_GROUP,name:"Gözləyən \(bütün açıq statuslar\)"\},\.\.\.orderStatuses\.map/);
});

// ---------------------------------------------------------------------------------------------------------------
// 4. List filters keep their values after "Filtrlə"
// ---------------------------------------------------------------------------------------------------------------

test("filter bar renders the applied search text and selected options", () => {
  const html = renderToStaticMarkup(createElement(Filters, { path: "/admin/products", q: "Nümunə" },
    createElement(FilterSelect, { name: "status", label: "Status", values: [{ id: "ACTIVE", name: "ACTIVE" }, { id: "DRAFT", name: "DRAFT" }], selected: "DRAFT" })));
  const searchInput = /<input[^>]*name="q"[^>]*>/.exec(html)?.[0] ?? "";
  assert.match(searchInput, /value="Nümunə"/, "the search box shows the applied text");
  assert.match(html, /<option value="DRAFT" selected="">DRAFT<\/option>/);
  assert.doesNotMatch(html, /<option value="ACTIVE" selected/);
  const unknown = renderToStaticMarkup(createElement(FilterSelect, { name: "status", label: "Status", values: [{ id: "ACTIVE", name: "ACTIVE" }], selected: "nonsense" }));
  assert.match(unknown, /<option value="" selected="">Hamısı<\/option>/, "an unknown value falls back to Hamısı");
});

test("every admin list filter passes its current values", () => {
  assert.doesNotMatch(sectionPage, /^function (Filters|FilterSelect)\(/m, "the shared components are used");
  const filterBars = sectionPage.match(/<Filters path="[^"]+"[^>]*>/g) ?? [];
  assert.ok(filterBars.length >= 13);
  for (const bar of filterBars) assert.match(bar, / q=\{q\}/, bar);
  const selects = sectionPage.match(/<FilterSelect name="(\w+)"(?:(?!\/>)[\s\S])*?\/>/g) ?? [];
  assert.ok(selects.length >= 13);
  for (const select of selects) {
    const name = /name="(\w+)"/.exec(select)![1];
    assert.match(select, new RegExp(`selected=\\{sp\\.${name}\\}`), select.slice(0, 80));
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 5–6. Dead branch removed; verification page in the navigation
// ---------------------------------------------------------------------------------------------------------------

test("only one subscriptions branch remains (the unreachable duplicate is gone)", () => {
  assert.equal(sectionPage.split('route==="subscriptions"').length - 1, 1);
  assert.match(sectionPage, /if\(route==="subscriptions"\)\{\n  const statuses=\["PENDING","ACTIVE","PAST_DUE","SUSPENDED","CANCELLED","EXPIRED"\] as const;const status=normalizeAdminEnumFilter\(sp\.status,statuses\);const where:any=status\?\{OR:/, "the live branch is the one kept");
});

test("/admin/verification is in the admin navigation", () => {
  const shell = read("components/admin-shell.tsx");
  assert.match(shell, /\["\/admin\/verification", "E-poçt təsdiqi gözləyənlər", MailCheck\]/);
  assert.ok(shell.indexOf('"/admin/customers"') < shell.indexOf('"/admin/verification"'), "next to customers");
});
