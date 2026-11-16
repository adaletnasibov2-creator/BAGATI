/** Sifariş (/admin/orders/:id). Moved unchanged from app/admin/[...section]/page.tsx. */
import { notFound } from "next/navigation";
import { allowedAdminOrderTransitions } from "@/lib/order-fulfillment";
import { prisma } from "@/lib/prisma";
import { type SectionContext, card, Header, StatusForm } from "./shared";
import { adminStatusLabel } from "@/lib/admin-labels";
import { formatAmount, formatMoney } from "@/lib/format-money";
import { AdminShipmentStatusControl } from "@/components/admin-shipment-status-control";
import { AdminCoordinatesReveal } from "@/components/admin-coordinates-reveal";
import { deliveryAddressText, maskCoordinates, readAddressSnapshot } from "@/lib/delivery-location";
import { CANCELLATION_TEXT, refundNeeded } from "@/lib/order-cancellation";

export async function renderOrderDetail({ parts, shell }: SectionContext) {
  const order = await prisma.order.findUnique({
   where: { id: parts[1] },
   include: {
    user: { include: { customerProfile: true } },
    storeOrders: {
     include: {
      store: { select: { id: true, name: true, vendor: { select: { displayName: true, user: { select: { email: true } } } } } },
      items: { include: { variant: true, product: { select: { name: true } } } },
      cancellationRequests: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, reason: true } },
     },
    },
    payments: true,
    delivery: true,
   },
  });
  if (!order) notFound();
  // Formatted address; the coordinates stay masked (not in the HTML) until revealed, which is audited.
  const delivery = readAddressSnapshot(order.addressSnapshot);
  const allowedOrderStatuses = allowedAdminOrderTransitions(order.storeOrders.map((group: any) => group.status));
  return shell(<>
   <Header title={`Sifariş · ${order.id.slice(-8).toUpperCase()}`} detail={`Yaradılıb ${order.createdAt.toLocaleString("az-AZ")} · Ümumi status ${adminStatusLabel("order", order.status)}`} />
   <div className="grid gap-5 xl:grid-cols-2">
    <section className={card}>
     <h2 className="font-semibold">Müştəri</h2>
     <p className="mt-3 text-sm">{order.user.customerProfile?.firstName || ""} {order.user.customerProfile?.lastName || ""} · {order.user.email}</p>
     <h3 className="mt-4 text-sm font-semibold">Çatdırılma ünvanı</h3>
     <p className="mt-1 text-sm">{[delivery.recipientName, delivery.phone].filter(Boolean).join(" · ") || "Alıcı qeyd edilməyib"}</p>
     <p className="mt-1 text-sm text-slate-600">{deliveryAddressText(delivery) || "Ünvan məlumatı yoxdur"}</p>
     {delivery.coordinates ? <AdminCoordinatesReveal orderId={order.id} masked={maskCoordinates(delivery.coordinates)} /> : <p className="mt-1 text-xs text-slate-500">Xəritə nöqtəsi yoxdur.</p>}
     <h3 className="mt-5 font-semibold">Ödəniş</h3>
     {order.payments.length
      ? order.payments.map((payment: any) => <p key={payment.id} className="mt-2 text-sm">{adminStatusLabel("payment", payment.status)} · {payment.currency === "AZN" ? formatMoney(payment.amount) : `${formatAmount(payment.amount)} ${payment.currency}`} · {payment.provider || "Provayder təyin edilməyib"}{payment.providerReference && !String(payment.providerReference).startsWith("claim:") ? ` · ${payment.providerReference}` : ""}</p>)
      : <p className="mt-2 text-sm text-slate-500">Ödəniş qeydi yoxdur.</p>}
    </section>
    <section className={card}>
     <h2 className="font-semibold">Cəmlər və çatdırılma</h2>
     <p className="mt-3 text-sm">Ara cəm: {formatMoney(order.subtotal)}</p>
     <p className="mt-1 text-sm">Çatdırılma haqqı: {formatMoney(order.deliveryFee)}</p>
     <p className="mt-1 text-sm font-semibold">Cəmi: {formatMoney(order.total)}</p>
     <p className="mt-4 text-sm">Çatdırılma: {order.delivery ? `${order.delivery.status} · ${order.delivery.carrier || "Daşıyıcı təyin edilməyib"} · ${order.delivery.trackingCode || "İzləmə kodu yoxdur"}` : "Çatdırılma qeydi yoxdur"}</p>
    </section>
   </div>
   <div className="mt-5"><StatusForm resource="orders" id={order.id} status={order.status} options={allowedOrderStatuses} button="Statusu saxla" /></div>
   <div className="mt-5 grid gap-4">
    {order.storeOrders.map((group: any) => <section key={group.id} className={card}>
     <h2 className="font-semibold">{group.store.name} · {adminStatusLabel("order", group.status)} · {formatMoney(group.subtotal)}</h2>
     {refundNeeded(order, group) && <p className="mt-2 inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900" data-refund-needed>{CANCELLATION_TEXT.refundPending}: ləğv edilib, ödəniş alınıb</p>}
     {group.cancellationRequests?.[0] && <p className="mt-2 text-sm text-slate-600">Müştərinin ləğv müraciəti: {({ REQUESTED: "açıq", APPROVED: "təsdiqlənib", REJECTED: "rədd edilib", WITHDRAWN: "geri götürülüb" } as Record<string, string>)[group.cancellationRequests[0].status]} · {group.cancellationRequests[0].reason}</p>}
     <p className="mt-2 text-sm text-slate-600">
      Çatdırılma: {group.deliveryMethod || "Mağaza ilə dəqiqləşdirilir"}
      {group.deliveryCarrier ? ` · ${group.deliveryCarrier}` : ""}
      {group.deliveryTrackingCode ? ` · İzləmə: ${group.deliveryTrackingCode}` : ""}
     </p>
     {group.deliveryNote && <p className="mt-1 text-sm text-slate-500">{group.deliveryNote}</p>}
     <p className="mt-1 text-xs text-slate-500">Satıcı: {group.store.vendor.displayName} · {group.store.vendor.user.email}</p>
     <AdminShipmentStatusControl storeOrderId={group.id} shipmentStatus={group.shipmentStatus} orderStatus={group.status} />
     <div className="mt-3 divide-y">
      {group.items.map((item: any) => <div key={item.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm">
       <span>{item.productName}{item.variant ? ` · ${item.variant.name}` : ""} × {item.quantity} {item.sku ? `· SKU ${item.sku}` : ""}</span>
       <span>{formatMoney(item.unitPrice)} × {item.quantity} = {formatMoney(item.lineTotal)}</span>
      </div>)}
     </div>
    </section>)}
   </div>
  </>);
}
