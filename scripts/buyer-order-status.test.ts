import assert from "node:assert/strict";
import test from "node:test";
import { paymentStatusLabel } from "../lib/order-status";

test("customer payment history status labels are localized", () => {
  assert.equal(paymentStatusLabel("PENDING"), "Ödəniş gözləyir");
  assert.equal(paymentStatusLabel("AUTHORIZED"), "Ödəniş təsdiqlənib");
  assert.equal(paymentStatusLabel("PAID"), "Ödənilib");
  assert.equal(paymentStatusLabel("FAILED"), "Ödəniş alınmadı");
  assert.equal(paymentStatusLabel("REFUNDED"), "Geri ödənilib");
});

test("missing or unknown payment statuses do not expose raw enum values", () => {
  assert.equal(paymentStatusLabel(), "Ödəniş qeydi yoxdur");
  assert.equal(paymentStatusLabel("UNEXPECTED"), "Status məlum deyil");
});
