import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import AdminMutationForm, { type AdminField } from "@/components/admin-mutation-form";
import AdminStoreProfileForm from "@/components/admin-store-profile-form";
import AdminStoreActivationAction from "@/components/admin-store-activation-action";
import AdminStoreArchiveAction from "@/components/admin-store-archive-action";
import AdminStoreReadiness from "@/components/admin-store-readiness";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { summarizeDeliveredSales } from "@/lib/admin-sales-report";
import { summarizeMonthlyStoreSales } from "@/lib/store-monthly-sales";
import { formatLocalDateInput, parseLocalDateRange } from "@/lib/admin-report-dates";
import { allowedAdminOrderTransitions } from "@/lib/order-fulfillment";
import AdminSiteSettingsForm from "@/components/admin-site-settings-form";
import AdminSettingsTabs from "@/components/admin-settings-tabs";
import AdminSettingField from "@/components/admin-setting-field";
import { loadAdminSettingsGroup, loadSettingSummary } from "@/lib/settings/admin";
import { SETTING_KEYS } from "@/lib/settings/registry";
import { commissionRateToPercent } from "@/lib/commission-rules";
import AdminHomepageManager from "@/components/admin-homepage-manager";
import AdminProductEditForm from "@/components/admin-product-edit-form";
import AdminPromotionManager from "@/components/admin-promotion-manager";
import AdminSubscriptionManager from "@/components/admin-subscription-manager";
import AdminProductImport from "@/components/admin-product-import";
import { SITE_SETTINGS_DEFAULTS } from "@/lib/site-content";
import { categoriesWithOtherLast } from "@/lib/category-order";
import { normalizeAdminEnumFilter, normalizeAdminPage, normalizeAdminSearch, normalizeAdminSearchParams } from "@/lib/admin-pagination";
import { missingSellerLegalFields } from "@/lib/seller-legal-policy";
import { complimentaryFromRows, resolveStoreEntitlements } from "@/lib/subscription-entitlements";
import { complimentaryGrantView, complimentaryHistorySelect } from "@/lib/complimentary-entitlements";
import AdminComplimentaryManager from "@/components/admin-complimentary-manager";
import { buildAdminStoreReadiness } from "@/lib/admin-store-readiness";
import { storeProfileOptions, toAdminStoreProfileView } from "@/lib/admin-store-profile";
import { Filters, FilterSelect } from "@/components/admin-list-filters";
import { adminOrderStatusWhere, ADMIN_PENDING_ORDER_GROUP } from "@/lib/admin-order-filters";

import { type SectionContext, card, storeStatuses, orderStatuses, productStatuses, Header, formatStoreCityName, formatSubscriptionSummary, Table, Pager, StatusForm } from "../_sections/shared";
import { ADMIN_SECTIONS } from "../_sections";

export const dynamic="force-dynamic";
const db:any=prisma;

export default async function AdminSectionPage({params,searchParams}:{params:Promise<{section:string[]}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const admin=await requireRole("ADMIN");if(!admin)redirect("/admin/login");
 const [{section:parts},rawSearchParams]=await Promise.all([params,searchParams]);const sp=normalizeAdminSearchParams(rawSearchParams);const route=parts.join("/");const q=normalizeAdminSearch(sp.q);const page=normalizeAdminPage(sp.page);const take=25,skip=(page-1)*take;const pageQuery=new URLSearchParams(Object.entries(sp).filter(([k,v])=>k!=="page"&&Boolean(v)) as [string,string][]).toString();
 const shell=(content:React.ReactNode)=><AdminShell email={admin.email}>{content}</AdminShell>;
 // Sections moved to app/admin/_sections/* (original order); the branches below are not moved yet.
 const ctx:SectionContext={admin,parts,route,sp,q,page,take,skip,pageQuery,shell};
 for(const section of ADMIN_SECTIONS)if(section.match(route,parts))return section.render(ctx);










 if (parts[0] === "orders" && parts.length === 2) {
  const order = await db.order.findUnique({
   where: { id: parts[1] },
   include: {
    user: { include: { customerProfile: true } },
    storeOrders: {
     include: {
      store: { select: { id: true, name: true, vendor: { select: { displayName: true, user: { select: { email: true } } } } } },
      items: { include: { variant: true, product: { select: { name: true } } } },
     },
    },
    payments: true,
    delivery: true,
   },
  });
  if (!order) notFound();
  const allowedOrderStatuses = allowedAdminOrderTransitions(order.storeOrders.map((group: any) => group.status));
  return shell(<>
   <Header title={`Sifariş · ${order.id.slice(-8).toUpperCase()}`} detail={`Yaradılıb ${order.createdAt.toLocaleString("az-AZ")} · Ümumi status ${order.status}`} />
   <div className="grid gap-5 xl:grid-cols-2">
    <section className={card}>
     <h2 className="font-semibold">Müştəri</h2>
     <p className="mt-3 text-sm">{order.user.customerProfile?.firstName || ""} {order.user.customerProfile?.lastName || ""} · {order.user.email}</p>
     <pre className="mt-3 whitespace-pre-wrap text-xs text-slate-500">Çatdırılma ünvanı: {JSON.stringify(order.addressSnapshot, null, 2)}</pre>
     <h3 className="mt-5 font-semibold">Ödəniş</h3>
     {order.payments.length
      ? order.payments.map((payment: any) => <p key={payment.id} className="mt-2 text-sm">{payment.status} · {Number(payment.amount).toFixed(2)} {payment.currency} · {payment.provider || "Provayder təyin edilməyib"}{payment.providerReference && !String(payment.providerReference).startsWith("claim:") ? ` · ${payment.providerReference}` : ""}</p>)
      : <p className="mt-2 text-sm text-slate-500">Ödəniş qeydi yoxdur.</p>}
    </section>
    <section className={card}>
     <h2 className="font-semibold">Cəmlər və çatdırılma</h2>
     <p className="mt-3 text-sm">Ara cəm: {Number(order.subtotal).toFixed(2)} ₼</p>
     <p className="mt-1 text-sm">Çatdırılma haqqı: {Number(order.deliveryFee).toFixed(2)} ₼</p>
     <p className="mt-1 text-sm font-semibold">Cəmi: {Number(order.total).toFixed(2)} ₼</p>
     <p className="mt-4 text-sm">Çatdırılma: {order.delivery ? `${order.delivery.status} · ${order.delivery.carrier || "Daşıyıcı təyin edilməyib"} · ${order.delivery.trackingCode || "İzləmə kodu yoxdur"}` : "Çatdırılma qeydi yoxdur"}</p>
    </section>
   </div>
   <div className="mt-5"><StatusForm resource="orders" id={order.id} status={order.status} options={allowedOrderStatuses} button="Statusu saxla" /></div>
   <div className="mt-5 grid gap-4">
    {order.storeOrders.map((group: any) => <section key={group.id} className={card}>
     <h2 className="font-semibold">{group.store.name} · {group.status} · {Number(group.subtotal).toFixed(2)} ₼</h2>
     <p className="mt-2 text-sm text-slate-600">
      Çatdırılma: {group.deliveryMethod || "Mağaza ilə dəqiqləşdirilir"}
      {group.deliveryCarrier ? ` · ${group.deliveryCarrier}` : ""}
      {group.deliveryTrackingCode ? ` · İzləmə: ${group.deliveryTrackingCode}` : ""}
     </p>
     {group.deliveryNote && <p className="mt-1 text-sm text-slate-500">{group.deliveryNote}</p>}
     <p className="mt-1 text-xs text-slate-500">Satıcı: {group.store.vendor.displayName} · {group.store.vendor.user.email}</p>
     <div className="mt-3 divide-y">
      {group.items.map((item: any) => <div key={item.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm">
       <span>{item.productName}{item.variant ? ` · ${item.variant.name}` : ""} × {item.quantity} {item.sku ? `· SKU ${item.sku}` : ""}</span>
       <span>{Number(item.unitPrice).toFixed(2)} × {item.quantity} = {Number(item.lineTotal).toFixed(2)} ₼</span>
      </div>)}
     </div>
    </section>)}
   </div>
  </>);
 }




 notFound();
}
