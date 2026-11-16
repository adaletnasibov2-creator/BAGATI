/**
 * Customer order cancellation master switch (owner decision 2026-11-16): admin setting
 * "orders.customerCancellationEnabled", default OFF. OFF hides the customer panel and makes the direct-cancel and
 * cancellation-request routes refuse on the server; ON keeps today's rules. Store decisions, store/admin cancels,
 * returns and the payment guards are not affected.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { getSettingDefinition, SETTING_GROUPS, SETTING_KEYS } from "../lib/settings/registry";
import {
  CUSTOMER_CANCELLATION_DISABLED_CODE,
  CUSTOMER_CANCELLATION_DISABLED_MESSAGE,
  customerCancellationGate,
  isCustomerCancellationEnabled,
} from "../lib/order-cancellation-switch";
import { canCancelOrderDirectly, canRequestStoreOrderCancellation } from "../lib/order-cancellation";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
const reader = (value: unknown) => async (key: string) => {
  assert.equal(key, "orders.customerCancellationEnabled", "reads only the master switch");
  return value;
};

test("setting: Sifarişlər group, boolean toggle, default OFF, cached read, Azerbaijani label and help", () => {
  assert.equal(SETTING_KEYS.ordersCustomerCancellationEnabled, "orders.customerCancellationEnabled");
  const definition = getSettingDefinition("orders.customerCancellationEnabled");
  assert.ok(definition);
  assert.equal(definition.group, "orders");
  assert.equal(SETTING_GROUPS.orders.label, "Sifarişlər");
  assert.equal(definition.label, "Müştəri sifariş ləğvi");
  assert.equal(definition.description, "Söndürülü olanda müştəri sifarişi ləğv edə bilməz; çatdırıldıqdan sonra qaytarma axını işləyir.");
  assert.equal(definition.default, false, "OFF by default");
  assert.equal(definition.read, "ttl", "read through the cached settings path");
  assert.deepEqual(definition.input, { kind: "toggle" });
  assert.equal(definition.permission, "settings.content");
  for (const [input, expected] of [[true, true], [false, false], ["true", true], ["false", false]] as const) {
    const parsed = definition.inputSchema.safeParse(input);
    assert.ok(parsed.success);
    assert.equal(parsed.data, expected);
  }
  assert.equal(definition.schema.safeParse("true").success, false, "stored value is a real boolean");
  // The admin tab exists and renders this group with the generic settings-engine page.
  assert.match(read("components/admin-settings-tabs.tsx"), /\{ id: "orders", label: "Sifarişlər", href: "\/admin\/settings\?tab=orders" \}/);
  assert.match(read("app/admin/_sections/settings.tsx"), /"catalog","orders"\] as const\)\.find\(tab=>tab===sp\.tab\)/);
});

test("reader: only a stored true means ON; unset (code default), false or anything else means OFF", async () => {
  assert.equal(await isCustomerCancellationEnabled(reader(true)), true);
  for (const value of [false, null, undefined, "true", 1, {}]) assert.equal(await isCustomerCancellationEnabled(reader(value)), false, String(value));
  // The production reader is the cached getSetting path (fail-safe: a failed read gives the default, OFF).
  const source = read("lib/order-cancellation-switch.ts");
  assert.match(source, /import \{ getSetting \} from "@\/lib\/settings\/read";/);
  assert.match(source, /const cachedRead: SettingReader = \(key\) => getSetting<boolean>\(key\);/);
});

test("OFF: the gate answers 403 with a clear Azerbaijani message and a code", async () => {
  const response = await customerCancellationGate(reader(false));
  assert.ok(response);
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.code, CUSTOMER_CANCELLATION_DISABLED_CODE);
  assert.equal(body.error, CUSTOMER_CANCELLATION_DISABLED_MESSAGE);
  assert.match(body.error, /ləğv etmək mümkün deyil/);
  assert.ok(await customerCancellationGate(reader(undefined)), "unset = OFF");
});

test("ON: the gate lets the request through and the cancellation rules are unchanged", async () => {
  assert.equal(await customerCancellationGate(reader(true)), null);
  // Today's rules, as before the switch: direct cancel while unpaid and unconfirmed; otherwise a request.
  const unconfirmed = { status: "PENDING", payments: [{ status: "PENDING" }], storeOrders: [{ id: "s1", status: "NEW", shipmentStatus: null }] };
  assert.equal(canCancelOrderDirectly(unconfirmed), true);
  const confirmed = { ...unconfirmed, storeOrders: [{ id: "s1", status: "CONFIRMED", shipmentStatus: null }] };
  assert.equal(canCancelOrderDirectly(confirmed), false);
  assert.equal(canRequestStoreOrderCancellation(confirmed, "s1"), true);
});

test("server: both customer routes refuse before reading the order; the rest of each route is unchanged", () => {
  for (const path of ["app/api/orders/[orderId]/cancel/route.ts", "app/api/orders/[orderId]/cancellation-requests/route.ts"]) {
    const source = read(path);
    const role = source.indexOf('requireRole("CUSTOMER")');
    const gate = source.indexOf("const disabled = await customerCancellationGate();");
    const params = source.indexOf("await params");
    assert.ok(role > 0 && gate > role && params > gate, `${path}: role check, then the switch, then the order`);
    assert.match(source, /if \(disabled\) return disabled;/, path);
    assert.match(source, /customerId: customer\.id/, `${path}: same service call as before when ON`);
  }
  // Not gated: the customer may still withdraw an existing request, and the store decides existing requests.
  assert.doesNotMatch(read("app/api/orders/[orderId]/cancellation-requests/[requestId]/route.ts"), /customerCancellationGate/);
  assert.doesNotMatch(read("app/api/vendor/[storeId]/cancellation-requests/[requestId]/route.ts"), /customerCancellationGate/);
});

test("page: OFF renders no cancellation panel (no buttons, no in-transit text); ON renders it as before", () => {
  const page = read("app/(customer)/orders/[orderId]/page.tsx");
  assert.match(page, /const cancellationEnabled=await isCustomerCancellationEnabled\(\);/);
  assert.match(page, /\{cancellationEnabled&&<OrderCancelActions orderId=\{order\.id\} direct=\{cancelView\.direct\} storeOrders=\{cancelRows\}\/>\}/);
  assert.equal(page.match(/<OrderCancelActions /g)?.length, 1, "the panel is rendered in exactly one place");
  // Every cancel button and the "Sifariş yoldadır" text live only inside the panel component.
  for (const text of ["Sifarişi ləğv et", "Ləğv müraciəti göndər", "CANCELLATION_TEXT"]) assert.ok(!page.includes(text), text);
  assert.ok(read("components/order-cancel-actions.tsx").includes("CANCELLATION_TEXT.inTransit"));
});

test("unchanged by the switch: store/admin cancels, returns, payment guards, refund-needed list", () => {
  for (const path of ["lib/order-fulfillment.ts", "lib/payments/epoint-protocol.ts", "lib/payments/epoint-checkout.ts", "app/admin/_sections/refunds.tsx", "app/api/account/returns/route.ts", "lib/order-cancellation-service.ts"]) {
    assert.doesNotMatch(read(path), /customerCancellation|order-cancellation-switch/, `${path} does not depend on the switch`);
  }
  assert.match(read("lib/payments/epoint-protocol.ts"), /if \(order\.status === "CANCELLED"\) return \{ code: "ORDER_CANCELLED" as const \};/);
  assert.match(read("lib/payments/epoint-checkout.ts"), /action: "PAYMENT_PAID_AFTER_CANCELLATION"/);
  assert.match(read("app/admin/_sections/refunds.tsx"), /where: \{ status: "CANCELLED", order: \{ payments: \{ some: \{ status: "PAID" \} \} \} \}/);
});
