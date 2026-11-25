import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { csrfRejection } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { ORDER_RECEIPT_IP_RATE_LIMIT, ORDER_RECEIPT_RATE_LIMIT, withinFormRateLimits } from "@/lib/form-rate-limit";
import { rateLimitedResponse } from "@/lib/rate-limit-response";
import { trustedCloudflareClientIp } from "@/lib/trusted-proxy";
import { confirmStoreOrderReceipt, OrderReceiptError } from "@/lib/order-receipt";
import { ORDER_NOTIFY_TEXT } from "@/lib/order-notify-text";

export const dynamic = "force-dynamic";

/**
 * ORDER-NOTIFY-1: the customer confirms receiving ONE store order ("Təhvil aldım"). Same CSRF and login rules as the
 * other customer order POST routes. Never changes the order status. Another customer's order: 404. Idempotent.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ orderId: string; storeOrderId: string }> }) {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const customer = await requireRole("CUSTOMER");
  if (!customer) return NextResponse.json({ error: "Daxil olmaq tələb olunur" }, { status: 401 });
  const clientIp = trustedCloudflareClientIp(request.headers);
  const allowed = await withinFormRateLimits([
    { scope: "order-receipt", identity: `user:${customer.id}`, ...ORDER_RECEIPT_RATE_LIMIT },
    ...(clientIp ? [{ scope: "order-receipt" as const, identity: `ip:${clientIp}`, ...ORDER_RECEIPT_IP_RATE_LIMIT }] : []),
  ], "order_receipt_rate_limit");
  if (!allowed) return rateLimitedResponse(10 * 60);
  const { orderId, storeOrderId } = await params;
  try {
    const result = await confirmStoreOrderReceipt(prisma, { customerId: customer.id, orderId, storeOrderId });
    return NextResponse.json({ ok: true, storeOrderId: result.storeOrderId, confirmedAt: result.confirmedAt.toISOString(), alreadyConfirmed: result.alreadyConfirmed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OrderReceiptError && error.code === "NOT_FOUND") return NextResponse.json({ error: "Sifariş tapılmadı" }, { status: 404 });
    if (error instanceof OrderReceiptError && error.code === "NOT_ALLOWED") return NextResponse.json({ error: ORDER_NOTIFY_TEXT.receiptNotAllowed }, { status: 409 });
    console.error(JSON.stringify({ event: "order_receipt.failed", error: error instanceof Error ? error.name : "unknown" }));
    return NextResponse.json({ error: "Əməliyyat uğursuz oldu." }, { status: 500 });
  }
}
