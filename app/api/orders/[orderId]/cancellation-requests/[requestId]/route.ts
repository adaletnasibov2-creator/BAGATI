import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { csrfRejection } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { withdrawStoreOrderCancellation } from "@/lib/order-cancellation-service";
import { cancellationErrorResponse } from "@/lib/order-cancellation-http";

export const dynamic = "force-dynamic";

/** The customer withdraws their own open cancellation request. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ orderId: string; requestId: string }> }) {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const customer = await requireRole("CUSTOMER");
  if (!customer) return NextResponse.json({ error: "Daxil olmaq tələb olunur" }, { status: 401 });
  const { orderId, requestId } = await params;
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400 }); }
  if (!z.object({ action: z.literal("withdraw") }).strict().safeParse(raw).success) return NextResponse.json({ error: "Əməliyyat yanlışdır" }, { status: 422 });
  try {
    return NextResponse.json({ item: await withdrawStoreOrderCancellation(prisma, { orderId, requestId, customerId: customer.id }) });
  } catch (error) {
    return cancellationErrorResponse(error, "customer_cancellation_withdraw");
  }
}
