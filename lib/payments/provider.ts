import { readEpointConfig } from "@/lib/payments/epoint-config";
import { createEpointTransport, requestEpointPayment, verifyEpointCallback } from "@/lib/payments/epoint-protocol";

export type PaymentState = "PENDING" | "AUTHORIZED" | "PAID" | "FAILED" | "REFUNDED";

export type PaymentRequest = {
  orderId: string;
  amount: string;
  currency: string;
  returnUrl: string;
};

export type PaymentSession = {
  redirectUrl: string;
  providerReference: string;
};

/** Implement this contract only when a real payment provider and verified webhook are configured. */
export interface PaymentProvider {
  createSession(input: PaymentRequest): Promise<PaymentSession>;
  verifyNotification(payload: Uint8Array, signature: string): Promise<{ providerReference: string; state: PaymentState }>;
}

/** Returns Epoint only when every required setting is present. Otherwise checkout stays pending. */
export function getPaymentProvider(): PaymentProvider | null {
  const config = readEpointConfig();
  if (!config) return null;
  const transport = createEpointTransport();
  return {
    async createSession(input) {
      const created = await requestEpointPayment(config, { paymentId: input.orderId, amount: input.amount, currency: input.currency, orderId: input.orderId }, transport);
      return { redirectUrl: created.redirectUrl, providerReference: created.transaction };
    },
    async verifyNotification(payload, signature) {
      const verified = verifyEpointCallback(config, new TextDecoder().decode(payload), signature);
      const state = verified.providerStatus === "success" ? "PAID" : verified.providerStatus === "returned" ? "REFUNDED" : verified.providerStatus === "failed" || verified.providerStatus === "error" ? "FAILED" : "PENDING";
      return { providerReference: verified.transaction, state };
    },
  };
}
