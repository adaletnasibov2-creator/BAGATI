/**
 * SELLER-ORDERS-DESIGN-1: seller order list and order page layout. Unit checks of the pure helpers (tab counts,
 * search scope, status strip with real timestamps only, first image) and source checks of the unchanged rules
 * (store scope / 404, no customer e-mail, no other store's amounts, no per-row queries). Live check: see the report.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildOrderTabs, countsFromGroups, destructiveLabel, formatOrderDateTime, itemThumbnail, needsAttention, orderNumber,
  orderTimeline, ORDER_TAB_STATUSES, SELLER_ORDERS_TEXT, splitTransitions, storeOrderTotal,
} from "../lib/vendor-order-view";
import { allowedVendorOrderTransitions, statusLabel, VENDOR_ORDER_STATUSES } from "../lib/order-status";
import { vendorOrderWhere } from "../lib/vendor-order-search";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const PAGE = "app/vendor/[storeId]/orders/[storeOrderId]/page.tsx";

test("tab counts: one grouped result -> total and per status; bad rows ignored", () => {
  const counts = countsFromGroups([
    { status: "NEW", _count: { _all: 3 } }, { status: "DELIVERED", _count: { _all: 13 } }, { status: "CANCELLED", _count: { _all: 2 } },
    { status: "PENDING", _count: { _all: 1 } }, { status: "READY", _count: { _all: 0 } }, { status: "", _count: { _all: 5 } },
  ]);
  assert.deepEqual(counts, { total: 19, byStatus: { NEW: 3, DELIVERED: 13, CANCELLED: 2, PENDING: 1 } });
  assert.deepEqual(countsFromGroups([]), { total: 0, byStatus: {} });
});

test("tabs: 'all' first, every normal status with the existing label (also at 0), legacy only when used or selected", () => {
  const tabs = buildOrderTabs({ total: 4, byStatus: { NEW: 3, PENDING: 1 } });
  assert.deepEqual(tabs[0], { status: "", label: "Bütün statuslar", count: 4 });
  assert.deepEqual(tabs.slice(1, 1 + ORDER_TAB_STATUSES.length).map((tab) => tab.status), [...ORDER_TAB_STATUSES]);
  for (const tab of tabs.slice(1)) assert.equal(tab.label, statusLabel(tab.status), "existing label, no new words");
  assert.equal(tabs.find((tab) => tab.status === "NEW")?.count, 3);
  assert.equal(tabs.find((tab) => tab.status === "READY")?.count, 0);
  assert.ok(tabs.some((tab) => tab.status === "PENDING"), "legacy status with orders gets a tab");
  assert.ok(!tabs.some((tab) => tab.status === "PROCESSING"), "unused legacy status has no tab");
  assert.ok(buildOrderTabs({ total: 0, byStatus: {} }, "SHIPPED").some((tab) => tab.status === "SHIPPED"), "selected legacy filter stays visible");
  assert.deepEqual([...ORDER_TAB_STATUSES], [...VENDOR_ORDER_STATUSES], "tabs follow the real vendor statuses");
});

test("search: always inside the seller's store; counts use the same search without the status", () => {
  type Where = { storeId: string; status?: string; AND?: { OR: { order?: { id: { contains: string } } }[] }[] };
  const where = vendorOrderWhere("store-a", null, "#f45ekg1p") as unknown as Where;
  assert.equal(where.storeId, "store-a");
  assert.equal(where.status, undefined);
  assert.equal(where.AND?.[0].OR[0].order?.id.contains, "f45ekg1p", "the # the seller sees is ignored");
  assert.equal((vendorOrderWhere("store-a", "NEW", "x") as unknown as Where).AND, undefined, "one letter is not a search");
  assert.throws(() => vendorOrderWhere("", null, null), /VENDOR_SCOPE_REQUIRED/);
  const route = read("app/api/vendor/[storeId]/[section]/route.ts");
  assert.match(route, /db\.storeOrder\.groupBy\(\{by:\["status"\],where:vendorOrderWhere\(storeId,null,req\.nextUrl\.searchParams\.get\("q"\)\),_count:\{_all:true\}\}\)/);
  assert.match(route, /return NextResponse\.json\(\{items,page,pageSize,total,totalPages,counts:countsFromGroups\(groups\)\}\);/);
  assert.equal(route.match(/storeOrder\.groupBy\(/g)?.length, 1, "one grouped query, not one count per tab");
});

test("list: one request per load, no per-row fetch; NEW highlighted with text badge; table and cards", () => {
  const list = read("components/vendor-orders.tsx");
  assert.equal(list.match(/fetch\(`\/api\/vendor\/\$\{encodeURIComponent\(storeId\)\}\/orders\?/g)?.length, 2, "load + refresh after a status change");
  assert.doesNotMatch(list, /\.map\([^)]*=>[^;]*fetch\(/, "no fetch inside a row map");
  assert.match(list, /data-order-tab=\{tab\.status \|\| "ALL"\} aria-pressed=\{active\}/);
  assert.match(list, /needsAttention\(order\.status\)/);
  assert.match(list, /<Badge tone=\{orderStatusTone\(order\.status\)\}/, "status is text, not colour only");
  assert.match(list, /hidden overflow-hidden rounded-card border border-line bg-white xl:block/);
  assert.match(list, /<ul className="grid gap-3 xl:hidden">/);
  assert.ok(needsAttention("NEW") && needsAttention("PENDING") && !needsAttention("CONFIRMED"));
});

test("dates: the same Baku-time string on the server and in every browser", () => {
  assert.equal(formatOrderDateTime("2026-11-24T14:51:53.000Z"), "24.11.2026, 18:51");
  assert.equal(formatOrderDateTime(new Date("2026-12-31T20:30:00.000Z")), "01.01.2027, 00:30");
  assert.equal(formatOrderDateTime(null), "");
  assert.equal(formatOrderDateTime("not a date"), "");
  assert.equal(orderNumber("cmwuu763n0018b7xsf45ekg1p"), "#F45EKG1P");
});

test("status strip: only stored timestamps, in time order; never confirmed/preparing/returned; cancel needs a decision time", () => {
  const created = "2026-11-20T10:00:00.000Z";
  assert.deepEqual(orderTimeline({ createdAt: created, status: "CONFIRMED" }).map((step) => step.key), ["created"]);
  const delivered = orderTimeline({ createdAt: created, status: "DELIVERED", shippedAt: "2026-11-21T08:00:00.000Z", outForDeliveryAt: "2026-11-21T12:00:00.000Z", deliveredAt: "2026-11-21T15:00:00.000Z" });
  assert.deepEqual(delivered.map((step) => [step.key, step.label]), [["created", "Yaradılıb"], ["shipped", "Yola salınıb"], ["outForDelivery", "Çatdırılma prosesindədir"], ["delivered", "Çatdırılıb"]]);
  assert.equal(delivered[3].at, "2026-11-21T15:00:00.000Z", "the stored moment, not a guess");
  // Delivered without the middle steps: only what exists.
  assert.deepEqual(orderTimeline({ createdAt: created, status: "DELIVERED", deliveredAt: "2026-11-22T10:00:00.000Z" }).map((step) => step.key), ["created", "delivered"]);
  // Cancelled: a step only with an approved request's time; a seller-side cancel has no stored time.
  assert.deepEqual(orderTimeline({ createdAt: created, status: "CANCELLED" }).map((step) => step.key), ["created"]);
  assert.deepEqual(orderTimeline({ createdAt: created, status: "CANCELLED", cancelledAt: "2026-11-20T11:00:00.000Z" }).map((step) => [step.key, step.label]), [["created", "Yaradılıb"], ["cancelled", "Ləğv edildi"]]);
  assert.deepEqual(orderTimeline({ createdAt: created, status: "NEW", cancelledAt: "2026-11-20T11:00:00.000Z" }).map((step) => step.key), ["created"], "a decision time alone does not make a cancel step");
  assert.deepEqual(orderTimeline({ createdAt: created, status: "RETURNED", deliveredAt: "bad" }).map((step) => step.key), ["created"], "invalid dates are dropped");
  for (const status of VENDOR_ORDER_STATUSES) for (const step of orderTimeline({ createdAt: created, status })) assert.ok(step.at, `${status}: every step has a real time`);
});

test("actions: the server's transitions, split into forward (primary) and cancel/return (separate); same confirmations", () => {
  assert.deepEqual(splitTransitions(allowedVendorOrderTransitions("NEW")), { forward: ["CONFIRMED"], destructive: ["CANCELLED"] });
  assert.deepEqual(splitTransitions(allowedVendorOrderTransitions("HANDED_TO_COURIER")), { forward: ["DELIVERED"], destructive: ["RETURNED"] });
  assert.deepEqual(splitTransitions(allowedVendorOrderTransitions("CANCELLED")), { forward: [], destructive: [] });
  assert.equal(destructiveLabel("CANCELLED"), "Sifarişi ləğv et", "existing wording (customer cancel button)");
  assert.equal(destructiveLabel("RETURNED"), "Qaytarıldı", "existing status label until the owner approves a new text");
  const actions = read("components/vendor-order-actions.tsx");
  assert.match(actions, /const \{ forward, destructive \} = splitTransitions\(transitions\);/);
  assert.match(actions, /CANCELLED: "Sifarişi ləğv etmək istədiyinizə əminsiniz\?/);
  assert.match(actions, /RETURNED: "Sifarişi qaytarılmış kimi qeyd etmək istədiyinizə əminsiniz\?/);
  assert.match(actions, /if \(mode === "order" && submitter\?\.name === "status"\) form\.set\("status", submitter\.value\);/);
  assert.match(actions, /data-order-destructive=""/);
});

test("items and totals: first image or the no-image box; store total = this store's items + this store's delivery", () => {
  assert.equal(itemThumbnail({ product: { images: ["/a.webp", "/b.webp"] } }), "/a.webp");
  assert.equal(itemThumbnail({ product: { images: ["", "/b.webp"] } }), "/b.webp");
  assert.equal(itemThumbnail({ product: { images: [] } }), null);
  assert.equal(itemThumbnail({ product: null }), null);
  assert.equal(storeOrderTotal({ subtotal: "48.00", deliveryFee: "4.00" }), 52);
  assert.equal(storeOrderTotal({ subtotal: 10, deliveryFee: null }), 10);
});

test("privacy: own store only (404 otherwise), no customer e-mail, no whole-order payment amount", () => {
  const page = read(PAGE);
  assert.match(page, /where: \{ id: storeOrderId, storeId: access\.storeId \}/);
  assert.match(page, /if \(!order\) notFound\(\);/);
  assert.doesNotMatch(page, /email/);
  assert.match(page, /payments: \{ select: \{ status: true \}/, "only the payment status; the amount can include other stores");
  assert.doesNotMatch(page, /payments\[0\]\.amount|currency: true/);
  assert.match(page, /db\.orderCancellationRequest\.findFirst\(\{ where: \{ storeOrderId: order\.id, status: "APPROVED" \}/, "scoped to this store order");
  assert.match(page, /product: \{ select: \{ images: true \} \}/, "thumbnails come with the same query (no per-item query)");
});

test("print: packing slip only when printing; no prices on it; seller chrome hidden by the print CSS only", () => {
  const page = read(PAGE);
  const slip = page.slice(page.indexOf("data-order-packing-slip"));
  assert.match(page, /<section data-order-packing-slip="" className="hidden text-\[11pt\] text-black print:block">/);
  assert.match(page, /<div className="space-y-5 print:hidden">/);
  assert.doesNotMatch(slip, /money\(|unitPrice|lineTotal|subtotal|deliveryFee/, "no prices on the packing slip");
  assert.match(slip, /customerName/); assert.match(slip, /\{phone\}/); assert.match(slip, /addressText/); assert.match(slip, /item\.quantity/);
  const css = read("app/globals.css");
  assert.match(css, /@media print \{\n  body:has\(\[data-order-packing-slip\]\) \[data-vendor-chrome\] \{ display: none !important; \}/);
  assert.match(read("app/vendor/[storeId]/layout.tsx"), /<header data-vendor-chrome="" className="sticky top-0/);
  assert.equal(read("components/vendor-navigation.tsx").match(/data-vendor-chrome=""/g)?.length, 2, "sidebar and phone menu bar");
});

test("hydration: the cancellation date is formatted the same way on server and client", () => {
  const banner = read("components/vendor-cancellation-request.tsx");
  assert.doesNotMatch(banner, /toLocaleString\(/);
  assert.match(banner, /\{request\.createdAtText \?\? formatOrderDateTime\(request\.createdAt\)\}/);
  assert.match(read(PAGE), /createdAtText: formatOrderDateTime\(openRequest\.createdAt\)/);
  assert.doesNotMatch(read("components/vendor-orders.tsx"), /toLocaleString\(/);
});

test("new visible words: only the two pending texts, in one place", () => {
  assert.deepEqual(SELLER_ORDERS_TEXT, { print: "Çap et", timeline: "Sifariş tarixçəsi" });
  assert.match(read("components/vendor-order-print-button.tsx"), /\{SELLER_ORDERS_TEXT\.print\}/);
  assert.match(read(PAGE), /\{SELLER_ORDERS_TEXT\.timeline\}/);
});
