import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedAdminOrderTransitions, OrderFulfillmentError, transitionAdminOrder, transitionVendorStoreOrder, validateOrderStatusTransition } from "@/lib/order-fulfillment";

function makeTransaction(options: { paymentStatus?: string; status?: string; quantity?: number; itemQuantity?: number } = {}) {
  const state = {
    parentStatus: "PENDING",
    storeStatus: options.status ?? "NEW",
    paymentStatuses: options.paymentStatus ? [options.paymentStatus] : ["PENDING"],
    quantity: options.quantity ?? 3,
    itemQuantity: options.itemQuantity ?? 2,
    adjustments: [] as Array<{ delta: number; previousQuantity: number; newQuantity: number }>,
  };
  const child = () => ({
    id: "store-order-1", orderId: "order-1", storeId: "store-1", status: state.storeStatus,
    order: { id: "order-1", payments: state.paymentStatuses.map((status) => ({ status })) },
  });
  const tx: any = {
    $queryRaw: async () => [],
    order: {
      findUnique: async ({ data, include }: any) => {
        if (data?.status) state.parentStatus = data.status;
        if (include?.storeOrders || include?.payments) {
          return { id: "order-1", status: state.parentStatus, payments: state.paymentStatuses.map((status) => ({ status })), storeOrders: [{ id: "store-order-1", storeId: "store-1", status: state.storeStatus }] };
        }
        return { id: "order-1", status: state.parentStatus };
      },
      update: async ({ data }: any) => { state.parentStatus = data.status; return { id: "order-1", status: state.parentStatus }; },
    },
    storeOrder: {
      findFirst: async () => child(),
      updateMany: async ({ where, data }: any) => {
        if (where.status !== state.storeStatus) return { count: 0 };
        state.storeStatus = data.status;
        return { count: 1 };
      },
      findMany: async () => [{ status: state.storeStatus }],
      findUnique: async () => ({ ...child(), items: [] }),
    },
    orderItem: {
      findMany: async () => [{ productId: "product-1", variantId: null, quantity: state.itemQuantity, product: { storeId: "store-1", variants: [] } }],
    },
    inventory: {
      findFirst: async () => ({ id: "inventory-1" }),
      findUnique: async () => ({ id: "inventory-1", quantity: state.quantity }),
      update: async ({ data }: any) => { state.quantity += data.quantity.increment; return { id: "inventory-1", quantity: state.quantity }; },
    },
    inventoryAdjustment: {
      create: async ({ data }: any) => { state.adjustments.push(data); return data; },
    },
  };
  return { state, tx };
}

test("admin order form offers only transitions accepted for every store order", () => {
  assert.deepEqual(allowedAdminOrderTransitions(["NEW"]), ["CONFIRMED", "CANCELLED"]);
  assert.deepEqual(allowedAdminOrderTransitions(["PREPARING", "PROCESSING"]), ["READY", "CANCELLED"]);
  assert.deepEqual(allowedAdminOrderTransitions(["DELIVERED"]), ["RETURNED"]);
  assert.deepEqual(allowedAdminOrderTransitions([]), []);
  assert.deepEqual(allowedAdminOrderTransitions(["NEW", "DELIVERED"]), []);
});

test("pending payment cannot transition a vendor or admin order to delivered", async () => {
  assert.equal(validateOrderStatusTransition("HANDED_TO_COURIER", "DELIVERED", ["PENDING"]), "PAYMENT_NOT_SETTLED");
  assert.equal(validateOrderStatusTransition("HANDED_TO_COURIER", "DELIVERED", []), "PAYMENT_NOT_SETTLED");
  assert.equal(validateOrderStatusTransition("HANDED_TO_COURIER", "DELIVERED", ["PAID"]), null);

  const { state, tx } = makeTransaction({ status: "HANDED_TO_COURIER", paymentStatus: "PENDING" });
  await assert.rejects(
    transitionAdminOrder(tx, { orderId: "order-1", actorUserId: "admin-1", targetStatus: "DELIVERED" }),
    (error: unknown) => error instanceof OrderFulfillmentError && error.code === "PAYMENT_NOT_SETTLED",
  );
  assert.equal(state.storeStatus, "HANDED_TO_COURIER");
  assert.equal(state.quantity, 3);

  const vendorState = makeTransaction({ status: "HANDED_TO_COURIER", paymentStatus: "PENDING" });
  await assert.rejects(
    transitionVendorStoreOrder(vendorState.tx, { id: "store-order-1", storeId: "store-1", actorUserId: "vendor-1", targetStatus: "DELIVERED" }),
    (error: unknown) => error instanceof OrderFulfillmentError && error.code === "PAYMENT_NOT_SETTLED",
  );
  assert.equal(vendorState.state.storeStatus, "HANDED_TO_COURIER");
  assert.equal(vendorState.state.quantity, 3);
});

test("admin cancellation restores the checkout-decremented stock once and records the adjustment", async () => {
  // Checkout reduced on-hand stock from five to three for this two-unit order.
  const { state, tx } = makeTransaction({ status: "NEW", paymentStatus: "PENDING", quantity: 3, itemQuantity: 2 });
  await transitionAdminOrder(tx, { orderId: "order-1", actorUserId: "admin-1", targetStatus: "CANCELLED" });
  assert.equal(state.storeStatus, "CANCELLED");
  assert.equal(state.parentStatus, "CANCELLED");
  assert.equal(state.quantity, 5);
  assert.equal(state.adjustments.length, 1);
  assert.deepEqual(state.adjustments[0], { inventoryId: "inventory-1", actorUserId: "admin-1", delta: 2, previousQuantity: 3, newQuantity: 5, reason: "Sifariş store-order-1 ləğv edildiyi üçün stok bərpa edildi" });
});

test("duplicate admin cancellation is rejected without restoring stock twice", async () => {
  const { state, tx } = makeTransaction({ status: "NEW", quantity: 3, itemQuantity: 2 });
  await transitionAdminOrder(tx, { orderId: "order-1", actorUserId: "admin-1", targetStatus: "CANCELLED" });
  await assert.rejects(
    transitionAdminOrder(tx, { orderId: "order-1", actorUserId: "admin-1", targetStatus: "CANCELLED" }),
    (error: unknown) => error instanceof OrderFulfillmentError && error.code === "INVALID_TRANSITION",
  );
  assert.equal(state.quantity, 5);
  assert.equal(state.adjustments.length, 1);
});
