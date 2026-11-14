import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { csrfRejection } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { buildDispatchLinks, readAddressSnapshot } from "@/lib/delivery-location";
import { logSecurityOperationFailure } from "@/lib/security-logging";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/**
 * Reveals an order's delivery coordinates to an admin and records it (audit ORDER_COORDINATES_VIEW, no coordinates in
 * the audit row). The admin order page shows them masked until this is called. Order: same-origin -> ADMIN -> lookup.
 */
export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403, headers });
  const { orderId } = await params;
  if (!orderId || orderId.length > 64) return NextResponse.json({ error: "Sifariş tapılmadı" }, { status: 404, headers });
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, addressSnapshot: true } });
    const view = order ? readAddressSnapshot(order.addressSnapshot) : null;
    if (!order || !view?.coordinates) return NextResponse.json({ error: "Bu sifarişdə xəritə nöqtəsi yoxdur" }, { status: 404, headers });
    await prisma.auditLog.create({ data: { actorId: admin.id, action: "ORDER_COORDINATES_VIEW", entityType: "Order", entityId: order.id } });
    const links = buildDispatchLinks(view, order.id);
    return NextResponse.json({ latitude: view.coordinates.latitude, longitude: view.coordinates.longitude, googleMaps: links.googleMaps, openStreetMap: links.openStreetMap }, { headers });
  } catch (error) {
    logSecurityOperationFailure("admin_order_coordinates", error);
    return NextResponse.json({ error: "Koordinatları göstərmək alınmadı." }, { status: 503, headers });
  }
}
