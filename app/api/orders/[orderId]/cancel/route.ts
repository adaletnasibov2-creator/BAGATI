import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { csrfRejection } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { cancelOrderByCustomer } from "@/lib/order-cancellation-service";
import { cancellationErrorResponse } from "@/lib/order-cancellation-http";

export const dynamic = "force-dynamic";

/** Rule 1: the customer cancels the whole order (unpaid, not confirmed by any store, not dispatched). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const customer = await requireRole("CUSTOMER");
  if (!customer) return NextResponse.json({ error: "Daxil olmaq tələb olunur" }, { status: 401 });
  const { orderId } = await params;
  try {
    const result = await cancelOrderByCustomer(prisma, { orderId, customerId: customer.id });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return cancellationErrorResponse(error, "customer_order_cancel");
  }
}
