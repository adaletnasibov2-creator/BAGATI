import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { csrfRejection } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { readJsonBodyLimited } from "@/lib/request-json";
import { logSecurityOperationFailure } from "@/lib/security-logging";
import { setShipmentStatusAsAdmin, ShipmentAdminError } from "@/lib/shipment-admin";
import { CANCELLATION_REQUEST_OPEN_MESSAGE } from "@/lib/order-cancellation-guard";
import { SHIPMENT_STATUSES } from "@/lib/shipment-tracking";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const bodySchema = z.object({ shipmentStatus: z.enum(SHIPMENT_STATUSES) }).strict();

/**
 * Admin sets a store order's shipment status (audited as SHIPMENT_STATUS_UPDATE). Never changes the order status,
 * payment, stock or finance, and sends no e-mail. Order: same-origin -> ADMIN -> bounded body -> validation -> one transaction.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ storeOrderId: string }> }) {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403, headers });
  const { storeOrderId } = await params;
  const body = await readJsonBodyLimited(request, 1024);
  if (!body.ok) return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: body.status, headers });
  const parsed = bodySchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: "Göndəriş statusu yanlışdır" }, { status: 422, headers });
  try {
    const item = await setShipmentStatusAsAdmin(prisma, { storeOrderId, actorId: admin.id, target: parsed.data.shipmentStatus });
    return NextResponse.json({ item, message: "Göndəriş statusu yeniləndi." }, { headers });
  } catch (error) {
    if (error instanceof ShipmentAdminError) {
      const status = error.code === "NOT_FOUND" ? 404 : 409;
      const message = error.code === "NOT_FOUND" ? "Mağaza sifarişi tapılmadı"
        : error.code === "ORDER_CLOSED" ? "Ləğv edilmiş və ya qaytarılmış sifarişin göndəriş statusu dəyişdirilə bilməz"
        : error.code === "INVALID_TRANSITION" ? "Bu göndəriş statusu keçidi mümkün deyil"
        : error.code === "CANCELLATION_REQUEST_OPEN" ? CANCELLATION_REQUEST_OPEN_MESSAGE
        : "Sifariş bu vaxt dəyişdirilib. Səhifəni yeniləyin.";
      return NextResponse.json({ error: message, code: error.code }, { status, headers });
    }
    logSecurityOperationFailure("admin_shipment_status", error);
    return NextResponse.json({ error: "Yadda saxlamaq alınmadı." }, { status: 503, headers });
  }
}
