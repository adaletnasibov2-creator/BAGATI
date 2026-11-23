import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireVendorStorePage } from "@/lib/vendor-area";
import { statusLabel, paymentStatusLabel } from "@/lib/order-status";
import VendorOrderActions from "@/components/vendor-order-actions";
import VendorCancellationRequest from "@/components/vendor-cancellation-request";
import { InteractiveMap } from "@/components/interactive-map";
import { buildCustomerWhatsAppUrl, buildTelHref, normalizeAzPhone } from "@/lib/az-phone";
import { VendorDeliveryAddressMenu } from "@/components/vendor-delivery-address-menu";
import { buildDispatchLinks, formatCoordinates, readAddressSnapshot, sellerCanSeeDeliveryLocation } from "@/lib/delivery-location";
import { VendorPageHeader } from "@/components/vendor-page-header";
import { Badge } from "@/components/ui/badge";
import { orderStatusTone } from "@/lib/vendor-status-tone";

export const dynamic = "force-dynamic";
const db: any = prisma;
const panel = "rounded-card border border-line bg-white p-5 sm:p-6";
const textValue = (value: unknown) => typeof value === "string" ? value : "";
function optionText(options: unknown) {
  if (!options || typeof options !== "object" || Array.isArray(options)) return "";
  return Object.entries(options).map(([key, value]) => `${key}: ${String(value)}`).join(" · ");
}

export default async function VendorOrderDetail({ params }: { params: Promise<{ storeId: string; storeOrderId: string }> }) {
  const { storeId, storeOrderId } = await params;
  const access = await requireVendorStorePage(storeId);
  if (!access) notFound();

  const order = await db.storeOrder.findFirst({
    where: { id: storeOrderId, storeId: access.storeId },
    include: {
      order: { select: { id: true, createdAt: true, addressSnapshot: true, payments: { select: { status: true, amount: true, currency: true }, orderBy: { createdAt: "desc" }, take: 1 }, user: { select: { customerProfile: { select: { firstName: true, lastName: true, phone: true } } } } } },
      items: { include: { variant: { select: { name: true, options: true } } } },
      cancellationRequests: { where: { status: "REQUESTED" }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, reason: true, createdAt: true } },
    },
  });
  if (!order) notFound();
  // All payments, not only the latest attempt: a paid order whose store order is cancelled needs a manual refund.
  const paid = (await db.payment.count({ where: { orderId: order.order.id, status: "PAID" } })) > 0;
  const openRequest = order.cancellationRequests[0] ?? null;

  const address = order.order.addressSnapshot && typeof order.order.addressSnapshot === "object" && !Array.isArray(order.order.addressSnapshot)
    ? order.order.addressSnapshot as Record<string, unknown>
    : {};
  const profile = order.order.user.customerProfile;
  const customerName = textValue(address.recipientName) || [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || "Ad qeyd edilməyib";
  const customerPhone = textValue(address.phone) || profile?.phone || null;
  // PHONE-REQUIRED-1: new orders store +994XXXXXXXXX; shown as +994 55 123 45 67. Older free-text phones are shown as typed.
  const phone = (normalizeAzPhone(customerPhone)?.display ?? customerPhone) || "Qeyd edilməyib";
  // The phone is already shown to this seller; it only becomes tappable (tel:, and WhatsApp for mobile numbers).
  const phoneTel = buildTelHref(customerPhone);
  const phoneWhatsApp = buildCustomerWhatsAppUrl(customerPhone, order.order.id);
  const addressLines = [address.line1, address.line2, address.city, address.postalCode].map(textValue).filter(Boolean);
  // Pin and dispatch menu: only while the order is open and for 7 days after the shipment is delivered (lib/delivery-location.ts).
  const locationAccess = sellerCanSeeDeliveryLocation(order);
  const deliveryView = readAddressSnapshot(order.order.addressSnapshot);
  const pin = locationAccess ? deliveryView.coordinates : null;
  const dispatchLinks = locationAccess && addressLines.length ? buildDispatchLinks(deliveryView, order.order.id) : null;

  return <div className="mx-auto max-w-5xl space-y-5">
    <VendorPageHeader
      back={<Link href={`/vendor/${storeId}/orders`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:text-primary-hover">← Sifarişlərə qayıt</Link>}
      eyebrow="Sifariş təfərrüatı"
      title={`#${order.order.id.slice(-8).toUpperCase()}`}
      description={<>Yaradılıb: {new Date(order.order.createdAt).toLocaleString("az-AZ")} <span aria-hidden="true">·</span> Ödəniş: {paymentStatusLabel(order.order.payments[0]?.status)}{order.order.payments[0] ? ` · ${Number(order.order.payments[0].amount).toFixed(2)} ${order.order.payments[0].currency}` : ""}</>}
      action={<Badge tone={orderStatusTone(order.status)} size="md">{statusLabel(order.status)}</Badge>}
    />

    <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
      <div className="space-y-5">
        <section className={panel}><h2 className="font-semibold text-[#142d38]">Müştəri və çatdırılma ünvanı</h2><dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-500">Alıcı</dt><dd className="mt-1 font-medium">{customerName}</dd></div><div><dt className="text-xs text-slate-500">Telefon</dt><dd className="mt-1 font-medium">{phoneTel ? <a href={phoneTel} className="text-[#28766f] underline-offset-2 hover:underline">{phone}</a> : phone}{phoneWhatsApp && <a href={phoneWhatsApp} target="_blank" rel="noopener noreferrer" className="ml-3 inline-flex min-h-9 items-center rounded-lg bg-[#1f7a4d] px-3 text-xs font-semibold text-white hover:bg-[#17633e]">WhatsApp ilə yaz</a>}</dd></div><div className="sm:col-span-2"><dt className="text-xs text-slate-500">Çatdırılma ünvanı</dt><dd className="mt-1 leading-6">{addressLines.length ? addressLines.join(", ") : "Ünvan məlumatı yoxdur"}</dd></div></dl>{dispatchLinks ? <div className="mt-4"><VendorDeliveryAddressMenu links={dispatchLinks} /></div> : !locationAccess && <p className="mt-4 text-xs leading-5 text-slate-500">Sifariş bağlandığı üçün xəritə nöqtəsi və çatdırılma menyusu artıq göstərilmir.</p>}</section>{pin&&<section className={panel}><h2 className="font-semibold text-[#142d38]">Çatdırılma xəritə nöqtəsi</h2><div className="mt-4"><InteractiveMap selected={pin} className="h-56" zoom={15}/></div><p className="mt-2 text-xs text-slate-500">{formatCoordinates(pin)}</p></section>}

        <section className={`${panel} overflow-hidden`}><div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-[#142d38]">Sifariş edilən məhsullar</h2><span className="text-sm text-slate-500">{order.items.length} mövqe</span></div><div className="mt-4 divide-y divide-[#eeeae2]">{order.items.map((item: any) => <article key={item.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center"><div className="min-w-0"><h3 className="font-medium text-[#243647]">{item.productName}</h3><p className="mt-1 text-xs text-slate-500">{(item.variantName||item.variant) ? `Variant: ${item.variantName||item.variant.name}${optionText(item.variantOptions??item.variant.options) ? ` · ${optionText(item.variantOptions??item.variant.options)}` : ""}` : "Standart məhsul"}{item.sku ? ` · Məhsul kodu: ${item.sku}` : ""}</p><p className="mt-1 text-xs text-slate-500">{Number(item.unitPrice).toFixed(2)} ₼ × {item.quantity}</p></div><b className="text-sm text-[#142d38]">{Number(item.lineTotal).toFixed(2)} ₼</b></article>)}</div><div className="mt-2 space-y-2 border-t border-[#ded9cf] pt-4 text-sm"><div className="flex justify-between"><span>Məhsulların cəmi</span><span>{Number(order.subtotal).toFixed(2)} AZN</span></div><div className="flex justify-between"><span>Çatdırılma haqqı</span><span>{Number(order.deliveryFee ?? 0).toFixed(2)} AZN</span></div><div className="flex justify-between border-t pt-2 font-semibold text-[#142d38]"><span>Mağaza sifarişinin cəmi</span><b>{(Number(order.subtotal) + Number(order.deliveryFee ?? 0)).toFixed(2)} AZN</b></div></div></section>
      </div>

      <div className="space-y-5"><section className={panel}><h2 className="font-semibold text-[#142d38]">Çatdırılma məlumatları</h2><dl className="mt-4 space-y-3 text-sm">{[["Çatdırılma üsulu", order.deliveryMethod], ["Daşıyıcı", order.deliveryCarrier], ["İzləmə kodu", order.deliveryTrackingCode], ["Çatdırılma qeydi", order.deliveryNote]].map(([label, value]) => <div key={String(label)}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words font-medium">{value || "Qeyd edilməyib"}</dd></div>)}</dl></section>
        <VendorCancellationRequest storeId={storeId} request={openRequest ? { id: openRequest.id, reason: openRequest.reason, createdAt: openRequest.createdAt.toISOString() } : null} paid={paid} refundPending={order.status === "CANCELLED" && paid}/>
        <VendorOrderActions storeId={storeId} storeOrderId={order.id} status={order.status} shipmentStatus={order.shipmentStatus} trackingUrl={order.trackingUrl} deliveryMethod={order.deliveryMethod} deliveryNote={order.deliveryNote} deliveryCarrier={order.deliveryCarrier} deliveryTrackingCode={order.deliveryTrackingCode}/>
      </div>
    </div>
  </div>;
}

