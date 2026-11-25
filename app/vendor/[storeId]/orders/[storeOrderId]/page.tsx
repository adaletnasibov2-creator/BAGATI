import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ImageOff, MessageCircle, Phone, Truck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireVendorStorePage } from "@/lib/vendor-area";
import { statusLabel, paymentStatusLabel } from "@/lib/order-status";
import VendorOrderActions from "@/components/vendor-order-actions";
import VendorCancellationRequest from "@/components/vendor-cancellation-request";
import { InteractiveMap } from "@/components/interactive-map";
import { buildCustomerWhatsAppUrl, buildTelHref, normalizeAzPhone } from "@/lib/az-phone";
import { VendorDeliveryAddressMenu } from "@/components/vendor-delivery-address-menu";
import { buildDispatchLinks, deliveryAddressParts, formatCoordinates, readAddressSnapshot, sellerCanSeeDeliveryLocation } from "@/lib/delivery-location";
import { VendorCopyButton } from "@/components/vendor-copy-button";
import { VendorPageHeader } from "@/components/vendor-page-header";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { orderStatusTone, paymentStatusTone } from "@/lib/vendor-status-tone";
import { VendorOrderPrintButton } from "@/components/vendor-order-print-button";
import { customerInitials, formatOrderDateTime, itemThumbnail, orderNumber, orderTimeline, SELLER_CUSTOMER_CARD_TEXT, SELLER_ORDERS_DESIGN_2_TEXT, SELLER_ORDERS_TEXT, storeOrderTotal } from "@/lib/vendor-order-view";
import { buildOnTheWayWhatsAppUrl } from "@/lib/seller-on-the-way";
import { formatPrice } from "@/lib/price";

export const dynamic = "force-dynamic";
const db: any = prisma;
const panel = "min-w-0 rounded-card border border-line bg-white p-5 sm:p-6";
const panelTitle = "font-display text-h3 text-fg";
const term = "text-xs font-medium text-fg-muted";
const textValue = (value: unknown) => typeof value === "string" ? value : "";
type OrderItemRow = { id: string; productName: string; variantName?: string | null; variantOptions?: unknown; sku?: string | null; quantity: number; unitPrice: unknown; lineTotal: unknown; variant?: { name: string; options: unknown } | null; product?: { images?: string[] | null } | null };
function optionText(options: unknown) {
  if (!options || typeof options !== "object" || Array.isArray(options)) return "";
  return Object.entries(options).map(([key, value]) => `${key}: ${String(value)}`).join(" · ");
}

/**
 * Seller order page (SELLER-ORDERS-DESIGN-1 layout). Same data rules as before: only this store's part of the order
 * (other stores' parts give 404), no customer e-mail, the address/pin rules of lib/delivery-location.ts, the same
 * actions. The packing slip at the end is shown only when printing.
 */
export default async function VendorOrderDetail({ params }: { params: Promise<{ storeId: string; storeOrderId: string }> }) {
  const { storeId, storeOrderId } = await params;
  const access = await requireVendorStorePage(storeId);
  if (!access) notFound();

  const order = await db.storeOrder.findFirst({
    where: { id: storeOrderId, storeId: access.storeId },
    include: {
      order: { select: { id: true, createdAt: true, addressSnapshot: true, payments: { select: { status: true }, orderBy: { createdAt: "desc" }, take: 1 }, user: { select: { customerProfile: { select: { firstName: true, lastName: true, phone: true } } } } } },
      // Product images come with the items in this one query (no per-line lookup). Only this store's lines (storeId above).
      items: { include: { variant: { select: { name: true, options: true } }, product: { select: { images: true } } } },
      store: { select: { name: true } },
      cancellationRequests: { where: { status: "REQUESTED" }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, reason: true, createdAt: true } },
    },
  });
  if (!order) notFound();
  // All payments, not only the latest attempt: a paid order whose store order is cancelled needs a manual refund.
  const paid = (await db.payment.count({ where: { orderId: order.order.id, status: "PAID" } })) > 0;
  const openRequest = order.cancellationRequests[0] ?? null;
  // The only stored moment of a cancellation: an approved request's decision time (status strip; never guessed).
  const approvedCancellation = order.status === "CANCELLED"
    ? await db.orderCancellationRequest.findFirst({ where: { storeOrderId: order.id, status: "APPROVED" }, orderBy: { decidedAt: "desc" }, select: { decidedAt: true } })
    : null;

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
  // SELLER-ORDERS-DESIGN-2: "on the way" message, only for READY / HANDED_TO_COURIER / SHIPPED and a mobile number. Never changes the status.
  const onTheWayWhatsApp = buildOnTheWayWhatsAppUrl(customerPhone, order.store?.name ?? "", order.order.id, order);
  const addressLines = [address.line1, address.line2, address.city, address.postalCode].map(textValue).filter(Boolean);
  // Pin and dispatch menu: only while the order is open and for 7 days after the shipment is delivered (lib/delivery-location.ts).
  const locationAccess = sellerCanSeeDeliveryLocation(order);
  const deliveryView = readAddressSnapshot(order.order.addressSnapshot);
  const pin = locationAccess ? deliveryView.coordinates : null;
  const dispatchLinks = locationAccess && addressLines.length ? buildDispatchLinks(deliveryView, order.order.id) : null;
  // SELLER-CUSTOMER-CARD-1: the address as separate labelled lines, and the number to copy (+994XXXXXXXXX, or as typed).
  const addressParts = deliveryAddressParts(deliveryView);
  const phoneCopy = normalizeAzPhone(customerPhone)?.e164 ?? customerPhone ?? null;

  const number = orderNumber(order.order.id);
  const created = formatOrderDateTime(order.order.createdAt);
  const paymentStatus = order.order.payments[0]?.status;
  // Only the payment STATUS is shown: the payment amount is the whole customer order, which can include other stores.
  const timeline = orderTimeline({ createdAt: order.order.createdAt, status: order.status, shippedAt: order.shippedAt, outForDeliveryAt: order.outForDeliveryAt, deliveredAt: order.deliveredAt, cancelledAt: approvedCancellation?.decidedAt });
  const variantLine = (item: OrderItemRow) => `${(item.variantName||item.variant) ? `Variant: ${item.variantName||item.variant?.name}${optionText(item.variantOptions??item.variant?.options) ? ` · ${optionText(item.variantOptions??item.variant?.options)}` : ""}` : "Standart məhsul"}${item.sku ? ` · Məhsul kodu: ${item.sku}` : ""}`;
  const addressText = addressLines.length ? addressLines.join(", ") : "Ünvan məlumatı yoxdur";
  const deliveryRows: [string, string | null][] = [["Çatdırılma üsulu", order.deliveryMethod], ["Daşıyıcı", order.deliveryCarrier], ["İzləmə kodu", order.deliveryTrackingCode], ["Çatdırılma qeydi", order.deliveryNote]];

  return <div className="mx-auto max-w-6xl">
    <div className="space-y-5 print:hidden">
      <VendorPageHeader
        back={<Link href={`/vendor/${storeId}/orders`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:text-primary-hover">← Sifarişlərə qayıt</Link>}
        eyebrow="Sifariş təfərrüatı"
        title={number}
        description={<span className="tabular-nums">Yaradılıb: {created}</span>}
        action={<>
          <Badge tone={orderStatusTone(order.status)} size="md">{statusLabel(order.status)}</Badge>
          <Badge tone={paymentStatusTone(paymentStatus)} size="md">{paymentStatusLabel(paymentStatus)}</Badge>
          <VendorOrderPrintButton/>
        </>}
      />

      <VendorCancellationRequest storeId={storeId} request={openRequest ? { id: openRequest.id, reason: openRequest.reason, createdAt: openRequest.createdAt.toISOString(), createdAtText: formatOrderDateTime(openRequest.createdAt) } : null} paid={paid} refundPending={order.status === "CANCELLED" && paid}/>

      {timeline.length > 1 && <section aria-labelledby="order-timeline-title" className={panel} data-order-timeline="">
        <h2 id="order-timeline-title" className="text-sm font-semibold text-fg">{SELLER_ORDERS_TEXT.timeline}</h2>
        <ol className="mt-4 grid gap-0 sm:flex sm:flex-wrap sm:gap-y-3">
          {timeline.map((step, index) => <li key={step.key} data-timeline-step={step.key} className="relative flex min-w-0 gap-3 pb-4 last:pb-0 sm:flex-1 sm:flex-col sm:gap-2 sm:pb-0 sm:pr-4">
            {index < timeline.length - 1 && <span aria-hidden="true" className="absolute left-[9px] top-5 h-[calc(100%-1.25rem)] w-0.5 bg-brand-200 sm:left-5 sm:right-0 sm:top-[9px] sm:h-0.5 sm:w-auto"/>}
            <span aria-hidden="true" className={cx("relative z-10 mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ring-4 ring-white sm:mt-0", step.key === "cancelled" ? "bg-danger" : "bg-primary")}><span className="h-1.5 w-1.5 rounded-full bg-white"/></span>
            <span className="min-w-0"><span className="block text-sm font-semibold text-fg">{step.label}</span><span className="block text-xs tabular-nums text-fg-secondary">{formatOrderDateTime(step.at)}</span></span>
          </li>)}
        </ol>
      </section>}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <section className={panel}>
            <div className="flex items-baseline justify-between gap-3"><h2 className={panelTitle}>Sifariş edilən məhsullar</h2><span className="text-sm text-fg-muted">{order.items.length} mövqe</span></div>
            <ul className="mt-4 divide-y divide-line">{order.items.map((item: OrderItemRow) => {
              const image = itemThumbnail(item);
              return <li key={item.id} className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-4 gap-y-1 py-4 first:pt-0 sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:items-center">
                <div className="row-span-2 grid aspect-square w-16 place-items-center overflow-hidden rounded-control border border-line bg-surface-page sm:row-span-1">{image ? <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a 64 px thumbnail; next/image would add ~6 kB of client JS to this page */}
                  <img src={image} alt={item.productName} width={64} height={64} loading="lazy" className="h-full w-full object-cover"/></> : <ImageOff aria-hidden="true" size={20} strokeWidth={2} className="text-fg-muted"/>}</div>
                <div className="min-w-0"><h3 className="break-words font-medium text-fg">{item.productName}</h3><p className="mt-1 break-words text-xs text-fg-muted">{variantLine(item)}</p><p className="mt-1 text-xs tabular-nums text-fg-secondary">{formatPrice(item.unitPrice)} × {item.quantity}</p></div>
                <b className="col-start-2 text-sm tabular-nums text-fg sm:col-start-auto sm:text-right">{formatPrice(item.lineTotal)}</b>
              </li>;
            })}</ul>
            <dl className="mt-4 space-y-2 rounded-control bg-surface-page p-4 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-fg-secondary">Məhsulların cəmi</dt><dd className="tabular-nums">{formatPrice(order.subtotal)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-fg-secondary">Çatdırılma haqqı</dt><dd className="tabular-nums">{formatPrice(order.deliveryFee ?? 0)}</dd></div>
              <div className="flex justify-between gap-3 border-t border-line pt-2 text-base font-semibold text-fg"><dt>Mağaza sifarişinin cəmi</dt><dd className="tabular-nums">{formatPrice(storeOrderTotal(order))}</dd></div>
            </dl>
          </section>

        </div>
        {/* Phones: right after the items, so the next step is near the top. Desktop: the right column (not sticky: the card is taller than a screen). */}
        <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <VendorOrderActions storeId={storeId} storeOrderId={order.id} status={order.status} shipmentStatus={order.shipmentStatus} trackingUrl={order.trackingUrl} deliveryMethod={order.deliveryMethod} deliveryNote={order.deliveryNote} deliveryCarrier={order.deliveryCarrier} deliveryTrackingCode={order.deliveryTrackingCode}/>
        </div>
        <div className="min-w-0 space-y-5 lg:col-start-1 lg:row-start-2">
          <section className={panel} data-customer-card="">
            <h2 className={panelTitle}>Müştəri və çatdırılma ünvanı</h2>
            <div className="mt-4 flex items-center gap-3">
              <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary-tint text-base font-semibold text-primary">{customerInitials(customerName)}</span>
              <div className="min-w-0"><p className={term}>Alıcı</p><p className="break-words text-base font-semibold text-fg">{customerName}</p></div>
            </div>
            <div className="mt-5 border-t border-line pt-5" data-customer-phone="">
              <p className={term}>Telefon</p>
              <p className="mt-1 text-xl font-semibold tabular-nums tracking-wide text-fg">{phone}</p>
              <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap sm:items-start">
                {phoneTel && <a href={phoneTel} className={cx(buttonClass({ size: "sm" }), "w-full sm:w-auto")}><Phone aria-hidden="true" size={16} strokeWidth={2}/>Zəng et</a>}
                {phoneWhatsApp && <a href={phoneWhatsApp} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[#1f7a4d] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#17633e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:w-auto"><MessageCircle aria-hidden="true" size={16} strokeWidth={2}/>WhatsApp ilə yaz</a>}
                {onTheWayWhatsApp && <a href={onTheWayWhatsApp} target="_blank" rel="noopener noreferrer" data-on-the-way="" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-[#1f7a4d] bg-white px-4 text-sm font-semibold text-[#1f7a4d] transition-colors hover:bg-[#eef7f2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:w-auto"><Truck aria-hidden="true" size={16} strokeWidth={2}/>{SELLER_ORDERS_DESIGN_2_TEXT.onTheWayButton}</a>}
                {phoneCopy && <VendorCopyButton value={phoneCopy} label={SELLER_CUSTOMER_CARD_TEXT.copyPhone} done={SELLER_CUSTOMER_CARD_TEXT.phoneCopied}/>}
              </div>
            </div>
            <div className="mt-5 border-t border-line pt-5" data-customer-address="">
              <p className={term}>Çatdırılma ünvanı</p>
              {addressParts.length
                ? <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">{addressParts.map((part) => <Fragment key={part.label}><dt className="text-fg-muted">{part.label}</dt><dd className="break-words font-medium text-fg">{part.value}</dd></Fragment>)}</dl>
                : <p className="mt-1 text-sm text-fg-body">Ünvan məlumatı yoxdur</p>}
              <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap sm:items-start">
                {dispatchLinks && <VendorDeliveryAddressMenu links={dispatchLinks} />}
                {addressLines.length > 0 && <VendorCopyButton value={addressLines.join(", ")} label="Ünvanı kopyala" done="Ünvan kopyalandı."/>}
              </div>
              {!locationAccess ? <p className="mt-3 text-xs leading-5 text-fg-muted">Sifariş bağlandığı üçün xəritə nöqtəsi və çatdırılma menyusu artıq göstərilmir.</p> : !pin && <p className="mt-3 text-xs leading-5 text-fg-muted" data-no-pin="">Xəritə nöqtəsi yoxdur.</p>}
            </div>
          </section>
          {pin&&<section className={panel}><h2 className={panelTitle}>Çatdırılma xəritə nöqtəsi</h2><div className="mt-4"><InteractiveMap selected={pin} className="h-56" zoom={15}/></div><div className="mt-3 flex flex-wrap items-start justify-between gap-2"><p className="pt-2.5 text-sm"><span className={term}>Koordinatlar </span><span className="tabular-nums text-fg">{formatCoordinates(pin)}</span></p><VendorCopyButton value={formatCoordinates(pin)} label={SELLER_CUSTOMER_CARD_TEXT.copyCoordinates} done={SELLER_CUSTOMER_CARD_TEXT.coordinatesCopied}/></div></section>}
        </div>
      </div>
    </div>

    {/* Packing slip: only when printing. This store's part only: number, date, customer, phone, address, items and quantities. */}
    <section data-order-packing-slip="" className="hidden text-[11pt] text-black print:block">
      <div className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
        <div><p className="text-xs uppercase tracking-wide">Sifariş təfərrüatı</p><p className="text-2xl font-bold">{number}</p></div>
        <p className="text-right text-sm tabular-nums">Yaradılıb: {created}</p>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
        <div><dt className="text-xs">Alıcı</dt><dd className="font-semibold">{customerName}</dd></div>
        <div><dt className="text-xs">Telefon</dt><dd className="font-semibold">{phone}</dd></div>
        <div className="col-span-2"><dt className="text-xs">Çatdırılma ünvanı</dt><dd>{addressText}</dd></div>
        {deliveryRows.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="text-xs">{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <table className="mt-5 w-full border-collapse text-left text-sm">
        <thead><tr className="border-b border-black"><th scope="col" className="py-2 pr-3">Sifariş edilən məhsullar</th><th scope="col" className="w-24 py-2 text-right">Miqdar</th></tr></thead>
        <tbody>{order.items.map((item: OrderItemRow) => { const image = itemThumbnail(item); return <tr key={item.id} className="break-inside-avoid border-b border-gray-400 align-top"><td className="py-2 pr-3"><div className="flex items-start gap-3" data-slip-item="">
          {/* SELLER-ORDERS-DESIGN-2: a small 12 mm image (or an empty box) so the packer can match the item; it never widens the table. */}
          <span className="block h-[12mm] w-[12mm] shrink-0 overflow-hidden border border-gray-400">{image && <>
            {/* eslint-disable-next-line @next/next/no-img-element -- print-only thumbnail; not lazy (hidden until printing), same URL as the thumbnail above so it is cached */}
            <img src={image} alt={item.productName} width={45} height={45} className="h-full w-full object-cover"/></>}</span>
          <span className="min-w-0"><b>{item.productName}</b><br/><span className="text-xs">{variantLine(item)}</span></span></div></td><td className="py-2 text-right text-base font-bold tabular-nums">{item.quantity}</td></tr>; })}</tbody>
      </table>
    </section>
  </div>;
}
