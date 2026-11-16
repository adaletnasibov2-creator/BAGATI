/** Static checks for the customer cancellation routes and their service (owner decisions 2026-11-16). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { buildTransactionalEmail, EMAIL_TEMPLATES } from "../lib/email-templates";
import { vendorNotificationHref, VENDOR_NOTIFICATION_TITLES } from "../lib/vendor-notifications";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const customerRoutes = [
  "app/api/orders/[orderId]/cancel/route.ts",
  "app/api/orders/[orderId]/cancellation-requests/route.ts",
  "app/api/orders/[orderId]/cancellation-requests/[requestId]/route.ts",
];
const sellerRoute = "app/api/vendor/[storeId]/cancellation-requests/[requestId]/route.ts";

test("customer routes: same-origin check first, then CUSTOMER role, then the service", () => {
  for (const path of customerRoutes) {
    const source = read(path);
    const csrf = source.indexOf("csrfRejection(request)");
    const role = source.indexOf('requireRole("CUSTOMER")');
    assert.ok(csrf > 0 && role > csrf, `${path}: csrf before role`);
    assert.match(source, /customerId: customer\.id/, `${path}: acts only for the signed-in customer`);
    assert.match(source, /cancellationErrorResponse\(error, "/, path);
  }
});

test("seller route: same-origin check, VENDOR store access, reason required to reject", () => {
  const source = read(sellerRoute);
  assert.ok(source.indexOf("csrfRejection(request)") < source.indexOf("requireStoreAccess(storeId)"));
  assert.match(source, /if \(!access \|\| access\.user\.role !== "VENDOR"\) return NextResponse\.json\(\{ error: "Mağazaya giriş icazəsi yoxdur" \}, \{ status: 403 \}\);/);
  assert.match(source, /parsed\.data\.decision === "REJECT" && !parsed\.data\.response\?\.trim\(\)/);
  assert.match(source, /decideStoreOrderCancellation\(prisma, \{ storeId, requestId, actorUserId: access\.user\.id,/);
});

test("service: every operation locks the order row and re-checks the rule inside the transaction", () => {
  const service = read("lib/order-cancellation-service.ts");
  assert.match(service, /await tx\.\$queryRaw`SELECT "id" FROM "Order" WHERE "id" = \$\{orderId\} FOR UPDATE`;/);
  assert.equal(service.match(/await lockOrder\(tx, /g)?.length, 4, "cancel, request, withdraw, decide");
  assert.match(service, /if \(!canCancelOrderDirectly\(rules\)\) throw new OrderCancellationError\("NOT_ALLOWED"\);/);
  assert.match(service, /if \(!canRequestStoreOrderCancellation\(rules, storeOrder\.id\)\) throw new OrderCancellationError\("NOT_ALLOWED"\);/);
  // Restock only through the store's own cancel transition (compare-and-set), never directly.
  assert.doesNotMatch(service, /inventory\.update/);
  assert.equal(service.match(/cancelStoreOrderLocked\(tx, /g)?.length, 2);
  // Direct cancel ends open payment attempts; nothing is refunded.
  assert.match(service, /tx\.payment\.updateMany\(\{ where: \{ orderId: order\.id, status: "PENDING" \}, data: \{ status: "FAILED" \} \}\)/);
  assert.doesNotMatch(service, /REFUNDED/);
  // Customer audit rows on cancel and request (and withdraw); the store's decision is audited too.
  for (const action of ["ORDER_CANCELLED_BY_CUSTOMER", "ORDER_CANCELLATION_REQUESTED", "ORDER_CANCELLATION_WITHDRAWN", "ORDER_CANCELLATION_${status}"]) assert.ok(service.includes(action), action);
});

test("messages: new e-mails render in Azerbaijani and seller notifications link to the orders page", () => {
  for (const template of ["SELLER_ORDER_CANCELLED", "SELLER_CANCELLATION_REQUEST", "CANCELLATION_REQUEST_DECISION"] as const) assert.ok(EMAIL_TEMPLATES.includes(template), template);
  const request = buildTransactionalEmail("SELLER_CANCELLATION_REQUEST", { storeName: "Mağaza", orderRef: "order-1", storeOrderRef: "so-1", reason: "Fikrimi dəyişdim" }, "BAGATI <no-reply@example.invalid>", "s@example.invalid", "<test@example.invalid>");
  assert.match(JSON.stringify(request), /ləğv müraciəti/);
  const approvedPaid = buildTransactionalEmail("CANCELLATION_REQUEST_DECISION", { orderRef: "order-1", storeName: "Mağaza", decision: "APPROVED", response: "", paid: "true" }, "BAGATI <no-reply@example.invalid>", "c@example.invalid", "<test@example.invalid>");
  assert.match(JSON.stringify(approvedPaid), /təsdiqləndi/);
  assert.match(JSON.stringify(approvedPaid), /əl ilə/);
  const rejected = buildTransactionalEmail("CANCELLATION_REQUEST_DECISION", { orderRef: "order-1", storeName: "Mağaza", decision: "REJECTED", response: "Artıq qablaşdırılıb", paid: "false" }, "BAGATI <no-reply@example.invalid>", "c@example.invalid", "<test@example.invalid>");
  assert.match(JSON.stringify(rejected), /rədd edildi/);
  assert.match(JSON.stringify(rejected), /Artıq qablaşdırılıb/);
  for (const title of [VENDOR_NOTIFICATION_TITLES.orderCancelledByCustomer, VENDOR_NOTIFICATION_TITLES.cancellationRequest, VENDOR_NOTIFICATION_TITLES.cancellationRequestWithdrawn]) {
    assert.equal(vendorNotificationHref("s1", title, true), "/vendor/s1/orders");
  }
});

test("UI: customer page, store order page and admin pages show the cancellation states", () => {
  const page = read("app/(customer)/orders/[orderId]/page.tsx");
  assert.match(page, /const cancelView=orderCancellationView\(/);
  assert.match(page, /<OrderCancelActions orderId=\{order\.id\} direct=\{cancelView\.direct\} storeOrders=\{cancelRows\}\/>/);
  const panel = read("components/order-cancel-actions.tsx");
  for (const text of ["Sifarişi ləğv et", "Bəli, ləğv et", "Ləğv müraciəti göndər", "Müraciəti geri götür", "CANCELLATION_TEXT.inTransit", "CANCELLATION_TEXT.refundPending"]) assert.ok(panel.includes(text), text);
  assert.match(read("lib/order-cancellation.ts"), /inTransit: "Sifariş yoldadır; çatdırıldıqdan sonra qaytarma müraciəti edə bilərsiniz\.",/);
  const seller = read("app/vendor/[storeId]/orders/[storeOrderId]/page.tsx");
  assert.match(seller, /cancellationRequests: \{ where: \{ status: "REQUESTED" \}/);
  assert.match(seller, /refundPending=\{order\.status === "CANCELLED" && paid\}/);
  assert.match(read("components/vendor-cancellation-request.tsx"), /Təsdiqlə və ləğv et/);
  assert.match(read("app/admin/_sections/refunds.tsx"), /where: \{ status: "CANCELLED", order: \{ payments: \{ some: \{ status: "PAID" \} \} \} \}/);
  assert.match(read("app/admin/_sections/order-detail.tsx"), /\{refundNeeded\(order, group\) && /);
});
