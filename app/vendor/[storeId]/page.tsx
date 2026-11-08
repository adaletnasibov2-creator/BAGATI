import Image from "next/image";
import Link from "next/link";
import { Activity, AlertTriangle, ArrowUpRight, BadgeCheck, ClipboardList, Package, PackageCheck, Plus, RotateCcw, ShoppingBag, TrendingUp } from "lucide-react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireStoreAccess } from "@/lib/auth";
import { statusLabel } from "@/lib/order-status";
import { getStorePublicationBlockers } from "@/lib/admin-store-product-publishing";

export const dynamic = "force-dynamic";
const db: any = prisma;
type Props = { params: Promise<{ storeId: string }> };

export default async function VendorOverview({ params }: Props) {
  const { storeId } = await params;
  const access = await requireStoreAccess(storeId);
  if (!access) notFound();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [store, today, pending, returnRequests, completed, productTotal, activeProducts, recentOrders, products, stockRows, salesToday] = await Promise.all([
    db.store.findUnique({ where: { id: storeId }, select: {
      name: true, status: true, isActive: true, adminManaged: true, legalInfoApproved: true,
      city: { select: { name: true, isActive: true } },
      vendor: { select: { sellerType: true, legalName: true, voen: true, legalAddress: true, user: { select: { isActive: true } } } },
      subscription: { select: {
        status: true, currentPeriodStart: true, currentPeriodEnd: true,
        plan: { select: { slug: true, isActive: true } },
      } },
    } }),
    db.storeOrder.count({ where: { storeId, createdAt: { gte: todayStart } } }),
    db.storeOrder.count({ where: { storeId, status: { in: ["NEW", "CONFIRMED", "PREPARING", "READY", "HANDED_TO_COURIER"] } } }),
    db.returnRequest.count({ where: { storeId, status: "REQUESTED" } }),
    db.storeOrder.count({ where: { storeId, status: "DELIVERED" } }),
    db.product.count({ where: { storeId } }),
    db.product.count({ where: { storeId, status: "ACTIVE" } }),
    db.storeOrder.findMany({ where: { storeId }, take: 5, orderBy: { createdAt: "desc" }, select: { id: true, status: true, subtotal: true, createdAt: true, order: { select: { id: true } } } }),
    db.product.findMany({ where: { storeId }, take: 6, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, price: true, status: true, images: true, updatedAt: true } }),
    db.inventory.findMany({ where: { product: { storeId } }, include: { product: { select: { id: true, name: true, sku: true } } }, orderBy: { quantity: "asc" } }),
    db.storeOrder.aggregate({ where: { storeId, status: "DELIVERED", OR: [{ deliveredAt: { gte: todayStart } }, { deliveredAt: null, createdAt: { gte: todayStart } }] }, _sum: { subtotal: true } }),
  ]);
  if (!store) notFound();
  const readinessBlockers = getStorePublicationBlockers({
    status: store.status,
    isActive: store.isActive,
    legalInfoApproved: store.legalInfoApproved,
    adminManaged: store.adminManaged,
    vendorActive: store.vendor.user.isActive,
    cityActive: store.city.isActive,
    sellerType: store.vendor.sellerType,
    legalName: store.vendor.legalName,
    voen: store.vendor.voen,
    legalAddress: store.vendor.legalAddress,
    subscriptionStatus: store.subscription?.status ?? null,
    planSlug: store.subscription?.plan.slug ?? null,
    planActive: store.subscription?.plan.isActive ?? false,
    periodStart: store.subscription?.currentPeriodStart ?? null,
    periodEnd: store.subscription?.currentPeriodEnd ?? null,
  });
  const outOfStock = stockRows.filter((item: any) => item.quantity - item.reserved <= 0).length;
  const lowStock = stockRows.filter((item: any) => item.quantity - item.reserved > 0 && item.quantity - item.reserved <= item.lowStockThreshold).length;
  const warnings = stockRows.filter((item: any) => Math.max(0, item.quantity - item.reserved) <= item.lowStockThreshold).slice(0, 6);
  const salesAmount = Number(salesToday._sum.subtotal || 0);
  const cards = [
    { label: "Bu g\u00FCn sifari\u015Fl\u0259r", value: today, href: "orders", Icon: ClipboardList, tone: "navy" },
    { label: "G\u00F6zl\u0259y\u0259n sifari\u015Fl\u0259r", value: pending, href: "orders", Icon: Activity, tone: "gold" },
    { label: "Yeni qaytar\u0131lma sor\u011Fular\u0131", value: returnRequests, href: "returns", Icon: RotateCcw, tone: "rose" },
    { label: "M\u0259hsullar", value: productTotal, href: "products", Icon: Package, tone: "neutral" },
    { label: "Aktiv m\u0259hsullar", value: activeProducts, href: "products", Icon: BadgeCheck, tone: "teal" },
    { label: "Tamamlanm\u0131\u015F sifari\u015Fl\u0259r", value: completed, href: "orders", Icon: PackageCheck, tone: "neutral" },
    { label: "Az stok", value: lowStock, href: "inventory", Icon: AlertTriangle, tone: "gold" },
    { label: "Stokda yoxdur", value: outOfStock, href: "inventory", Icon: ShoppingBag, tone: "rose" },
    { label: "Bu g\u00FCn t\u0259hvil verilmi\u015F sat\u0131\u015F", value: `${salesAmount.toFixed(2)} AZN`, href: "sales", Icon: TrendingUp, tone: "teal" },
  ] as const;
  const tones: Record<string, string> = { navy: "bg-[#e9eef1] text-[#173c40]", gold: "bg-[#f4ecd9] text-[#8c6b2b]", neutral: "bg-[#f1f0eb] text-[#536273]", teal: "bg-[#e4efeb] text-[#28766f]", rose: "bg-[#f8e9e7] text-[#a44940]" };

  return <div className="space-y-7">
    <section className="relative overflow-hidden rounded-[24px] bg-[#122b37] p-5 text-white shadow-[0_16px_40px_rgba(18,43,55,.12)] sm:p-7 lg:p-8">
      <div aria-hidden="true" className="absolute -right-14 -top-28 h-72 w-72 rounded-full border border-[#e6c77d]/20 sm:right-[6%] sm:top-[-55%] sm:h-96 sm:w-96"/>
      <div className="relative flex flex-wrap items-end justify-between gap-5">
        <div><p className="text-xs font-semibold uppercase tracking-[.18em] text-[#e6c77d]">BAGATI satıcı paneli</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Salam, {store.name}</h1><p className="mt-2 text-sm text-white/70">{store.city.name} <span aria-hidden="true">·</span> {store.isActive ? "İctimai görünürlük aktivdir" : "İctimai görünürlük deaktivdir"}</p><div className="mt-2 text-sm"><p className={readinessBlockers.length ? "font-medium text-amber-200" : "font-medium text-emerald-200"}>{readinessBlockers.length ? "İctimai satışa hazır deyil" : "İctimai satışa hazırdır"}</p>{readinessBlockers.length > 0 && <ul className="mt-1 list-inside list-disc text-white/80">{readinessBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}</div></div>
        <div className="flex flex-wrap gap-2"><Link href={`/vendor/${storeId}/orders`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/20 px-4 text-sm font-medium text-white transition hover:bg-white/10"><ClipboardList size={16}/> Sifarişlər</Link><Link href={`/vendor/${storeId}/products/new`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#e6c77d] px-4 text-sm font-semibold text-[#142d38] transition hover:bg-[#f0d895]"><Plus size={17}/> Məhsul əlavə et</Link></div>
      </div>
    </section>
    <section aria-label="Mağaza göstəriciləri" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({ label, value, href, Icon, tone })=><Link key={label} href={`/vendor/${storeId}/${href}`} className="group rounded-2xl border border-[#e9e4da] bg-white p-4 transition hover:-translate-y-0.5 hover:border-[#cbb47e] hover:shadow-[0_12px_28px_rgba(11,23,38,.06)] sm:p-5"><div className="flex items-start justify-between gap-3"><span className={`grid h-10 w-10 place-items-center rounded-xl ${tones[tone]}`}><Icon size={18}/></span><ArrowUpRight size={16} className="text-slate-300 transition group-hover:text-[#967844]"/></div><p className="mt-4 text-xs leading-5 text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold tracking-tight text-[#142d38]">{value}</p></Link>)}</section>
    <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
      <section className="overflow-hidden rounded-2xl border border-[#e9e4da] bg-white"><div className="flex items-center justify-between gap-3 border-b border-[#eeeae2] px-5 py-4"><div><p className="text-[.65rem] font-semibold uppercase tracking-[.16em] text-[#967844]">Son fəaliyyət</p><h2 className="mt-1 font-semibold text-[#142d38]">Son sifarişlər</h2></div><Link className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-[#28766f]" href={`/vendor/${storeId}/orders`}>Hamısını <ArrowUpRight size={15}/></Link></div><div className="divide-y divide-[#eeeae2]">{recentOrders.length ? recentOrders.map((order:any)=><Link key={order.id} href={`/vendor/${storeId}/orders/${order.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-[#fbfaf8]"><span><span className="block text-sm font-semibold text-[#142d38]">#{order.order.id.slice(-8).toUpperCase()}</span><span className="mt-1 block text-xs text-slate-500">{new Date(order.createdAt).toLocaleString("az-AZ")}</span></span><span className="flex items-center gap-3"><span className="rounded-full bg-[#f3f1eb] px-2.5 py-1 text-xs font-medium text-[#536273]">{statusLabel(order.status)}</span><b className="text-sm">{Number(order.subtotal).toFixed(2)} AZN</b></span></Link>) : <div className="p-7 text-center"><ClipboardList className="mx-auto text-slate-300" size={25}/><p className="mt-2 text-sm font-medium text-[#344254]">Hələ sifariş yoxdur</p><p className="mt-1 text-xs text-slate-500">Yeni sifarişlər bu bölmədə görünəcək.</p></div>}</div></section>
      <section className="overflow-hidden rounded-2xl border border-[#e9e4da] bg-white"><div className="flex items-center justify-between gap-3 border-b border-[#eeeae2] px-5 py-4"><div><p className="text-[.65rem] font-semibold uppercase tracking-[.16em] text-[#967844]">Stok nəzarəti</p><h2 className="mt-1 font-semibold text-[#142d38]">Anbar xəbərdarlıqları</h2></div><Link href={`/vendor/${storeId}/inventory`} aria-label="Anbara bax" className="grid h-10 w-10 place-items-center rounded-xl text-[#28766f] hover:bg-[#f4f7f4]"><ArrowUpRight size={17}/></Link></div><div className="divide-y divide-[#eeeae2]">{warnings.length ? warnings.map((item:any)=><Link key={item.id} href={`/vendor/${storeId}/inventory`} className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-[#fbfaf8]"><span className="min-w-0"><span className="block truncate text-sm font-medium text-[#243647]">{item.product.name}</span><span className="mt-1 block truncate text-xs text-slate-500">SKU: {item.product.sku||"—"}</span></span><span className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${item.quantity-item.reserved<=0?"bg-red-50 text-red-700":"bg-amber-50 text-amber-800"}`}>{Math.max(0,item.quantity-item.reserved)} ədəd</span></Link>) : <div className="p-7 text-center"><BadgeCheck className="mx-auto text-[#28766f]" size={25}/><p className="mt-2 text-sm font-medium text-[#344254]">Aşağı ehtiyatlı məhsul yoxdur</p><p className="mt-1 text-xs text-slate-500">Stok yeniləndikcə xəbərdarlıqlar burada görünəcək.</p></div>}</div></section>
    </div>
    <section className="overflow-hidden rounded-2xl border border-[#e9e4da] bg-white"><div className="flex items-center justify-between gap-3 border-b border-[#eeeae2] px-5 py-4"><div><p className="text-[.65rem] font-semibold uppercase tracking-[.16em] text-[#967844]">Kataloq</p><h2 className="mt-1 font-semibold text-[#142d38]">Son məhsullar</h2></div><Link href={`/vendor/${storeId}/products`} className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-[#28766f]">Kataloqa bax <ArrowUpRight size={15}/></Link></div>{products.length ? <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">{products.map((product:any)=><Link key={product.id} href={`/vendor/${storeId}/products/${product.id}`} className="group flex min-w-0 items-center gap-3 rounded-xl border border-transparent bg-[#f8f7f4] p-3 transition hover:border-[#d9a441]/50 hover:bg-white"><div className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-white text-center text-[9px] text-slate-500">{product.images?.[0]?<Image src={product.images[0]} alt="" fill sizes="56px" unoptimized={/^https?:\/\//i.test(product.images[0])} className="object-cover"/>:"Şəkil yoxdur"}</div><span className="min-w-0"><span className="block truncate text-sm font-medium text-[#243647] group-hover:text-[#28766f]">{product.name}</span><span className="mt-1 block text-xs text-slate-500">{Number(product.price).toFixed(2)} AZN <span aria-hidden="true">·</span> {product.status}</span></span></Link>)}</div> : <div className="p-7 text-center"><Package className="mx-auto text-slate-300" size={25}/><p className="mt-2 text-sm font-medium">Məhsul yoxdur</p><p className="mt-1 text-xs text-slate-500">Kataloqunuzu ilk məhsulla yaradın.</p><Link href={`/vendor/${storeId}/products/new`} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#173c40] px-4 text-sm font-medium text-white"><Plus size={15}/> Məhsul əlavə et</Link></div>}</section>
  </div>;
}
