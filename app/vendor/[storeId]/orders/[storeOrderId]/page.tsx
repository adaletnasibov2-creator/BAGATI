import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireVendorStorePage } from "@/lib/vendor-area";
import { statusLabel, paymentStatusLabel } from "@/lib/order-status";
import VendorOrderActions from "@/components/vendor-order-actions";
import { InteractiveMap } from "@/components/interactive-map";

export const dynamic = "force-dynamic";
const db: any = prisma;
const panel = "rounded-2xl border border-[#e9e4da] bg-white p-5 sm:p-6";
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
    },
  });
  if (!order) notFound();

  const address = order.order.addressSnapshot && typeof order.order.addressSnapshot === "object" && !Array.isArray(order.order.addressSnapshot)
    ? order.order.addressSnapshot as Record<string, unknown>
    : {};
  const profile = order.order.user.customerProfile;
  const customerName = textValue(address.recipientName) || [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || "Ad qeyd edilməyib";
  const phone = textValue(address.phone) || profile?.phone || "Qeyd edilməyib";
  const addressLines = [address.line1, address.line2, address.city, address.postalCode].map(textValue).filter(Boolean);
  const latitude = typeof address.latitude === "number" && Number.isFinite(address.latitude) && Math.abs(address.latitude) <= 90 ? address.latitude : null;
  const longitude = typeof address.longitude === "number" && Number.isFinite(address.longitude) && Math.abs(address.longitude) <= 180 ? address.longitude : null;

  return <div className="mx-auto max-w-5xl space-y-5">
    <div><Link href={`/vendor/${storeId}/orders`} className="text-sm font-medium text-[#28766f] hover:underline">← Sifarişlərə qayıt</Link><div className="mt-4 flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.15em] text-[#967844]">Sifariş təfərrüatı</p><h1 className="mt-1 text-2xl font-semibold text-[#142d38] sm:text-3xl">#{order.order.id.slice(-8).toUpperCase()}</h1><p className="mt-2 text-sm text-slate-500">Yaradılıb: {new Date(order.order.createdAt).toLocaleString("az-AZ")}</p><p className="mt-1 text-sm text-slate-500">Ödəniş: {paymentStatusLabel(order.order.payments[0]?.status)}{order.order.payments[0] ? ` · ${Number(order.order.payments[0].amount).toFixed(2)} ${order.order.payments[0].currency}` : ""}</p></div><span className="rounded-full bg-[#f3f1eb] px-3 py-2 text-sm font-medium text-[#536273]">{statusLabel(order.status)}</span></div></div>

    <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
      <div className="space-y-5">
        <section className={panel}><h2 className="font-semibold text-[#142d38]">Müştəri və çatdırılma ünvanı</h2><dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-500">Alıcı</dt><dd className="mt-1 font-medium">{customerName}</dd></div><div><dt className="text-xs text-slate-500">Telefon</dt><dd className="mt-1 font-medium">{phone}</dd></div><div className="sm:col-span-2"><dt className="text-xs text-slate-500">Çatdırılma ünvanı</dt><dd className="mt-1 leading-6">{addressLines.length ? addressLines.join(", ") : "Ünvan məlumatı yoxdur"}</dd></div></dl></section>{latitude!==null&&longitude!==null&&<section className={panel}><h2 className="font-semibold text-[#142d38]">Çatdırılma xəritə nöqtəsi</h2><div className="mt-4"><InteractiveMap selected={{latitude,longitude}} className="h-56" zoom={14}/></div></section>}

        <section className={`${panel} overflow-hidden`}><div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-[#142d38]">Sifariş edilən məhsullar</h2><span className="text-sm text-slate-500">{order.items.length} mövqe</span></div><div className="mt-4 divide-y divide-[#eeeae2]">{order.items.map((item: any) => <article key={item.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center"><div className="min-w-0"><h3 className="font-medium text-[#243647]">{item.productName}</h3><p className="mt-1 text-xs text-slate-500">{(item.variantName||item.variant) ? `Variant: ${item.variantName||item.variant.name}${optionText(item.variantOptions??item.variant.options) ? ` · ${optionText(item.variantOptions??item.variant.options)}` : ""}` : "Standart məhsul"}{item.sku ? ` · Məhsul kodu: ${item.sku}` : ""}</p><p className="mt-1 text-xs text-slate-500">{Number(item.unitPrice).toFixed(2)} ₼ × {item.quantity}</p></div><b className="text-sm text-[#142d38]">{Number(item.lineTotal).toFixed(2)} ₼</b></article>)}</div><div className="mt-2 space-y-2 border-t border-[#ded9cf] pt-4 text-sm"><div className="flex justify-between"><span>Məhsulların cəmi</span><span>{Number(order.subtotal).toFixed(2)} AZN</span></div><div className="flex justify-between"><span>Çatdırılma haqqı</span><span>{Number(order.deliveryFee ?? 0).toFixed(2)} AZN</span></div><div className="flex justify-between border-t pt-2 font-semibold text-[#142d38]"><span>Mağaza sifarişinin cəmi</span><b>{(Number(order.subtotal) + Number(order.deliveryFee ?? 0)).toFixed(2)} AZN</b></div></div></section>
      </div>

      <div className="space-y-5"><section className={panel}><h2 className="font-semibold text-[#142d38]">Çatdırılma məlumatları</h2><dl className="mt-4 space-y-3 text-sm">{[["Çatdırılma üsulu", order.deliveryMethod], ["Daşıyıcı", order.deliveryCarrier], ["İzləmə kodu", order.deliveryTrackingCode], ["Çatdırılma qeydi", order.deliveryNote]].map(([label, value]) => <div key={String(label)}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words font-medium">{value || "Qeyd edilməyib"}</dd></div>)}</dl></section>
        <VendorOrderActions storeId={storeId} storeOrderId={order.id} status={order.status} shipmentStatus={order.shipmentStatus} trackingUrl={order.trackingUrl} deliveryMethod={order.deliveryMethod} deliveryNote={order.deliveryNote} deliveryCarrier={order.deliveryCarrier} deliveryTrackingCode={order.deliveryTrackingCode}/>
      </div>
    </div>
  </div>;
}

