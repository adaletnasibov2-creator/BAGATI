import type { PaymentSnapshot, SettlementDecision, VerifiedEpointResult } from "@/lib/payments/epoint-protocol";
import { decideEpointSettlement } from "@/lib/payments/epoint-protocol";

export type PaymentRepository = {
  find(id: string): Promise<PaymentSnapshot | null>;
  compareAndSet(id: string, from: PaymentSnapshot["status"], to: "PAID" | "FAILED" | "REFUNDED", transaction: string): Promise<boolean>;
};

/** Applies one verified provider result. A repeated or racing callback cannot apply the effect twice. */
export async function commitEpointSettlement(repository: PaymentRepository, result: VerifiedEpointResult): Promise<SettlementDecision> {
  const payment = await repository.find(result.paymentId);
  const decision = decideEpointSettlement(payment, result);
  if (decision.type !== "set" || !payment) return decision;
  const updated = await repository.compareAndSet(payment.id, payment.status, decision.status, result.transaction);
  if (updated) return decision;
  const current = await repository.find(result.paymentId);
  const replay = decideEpointSettlement(current, result);
  return replay.type === "set" ? { type: "unchanged", status: current?.status ?? payment.status } : replay;
}
