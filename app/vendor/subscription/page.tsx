import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { currentUser } from "@/lib/auth";
import { vendorAreaRedirectPath } from "@/lib/vendor-area";
import { prisma } from "@/lib/prisma";
import { VendorTheme } from "@/components/vendor-theme";
import { VendorPageHeader } from "@/components/vendor-page-header";
import { ButtonLink } from "@/components/ui/button";

export const dynamic = "force-dynamic";
const db: any = prisma;
const labels: Record<string, string> = { PENDING: "Ödəniş gözləyir", ACTIVE: "Aktiv", PAST_DUE: "Ödəniş gecikib", SUSPENDED: "Dayandırılıb", CANCELLED: "Ləğv edilib", EXPIRED: "Bitib" };

export default async function VendorSubscriptionsPage() {
  const user = await currentUser();
  if (!user || user.role !== "VENDOR") redirect(vendorAreaRedirectPath(user?.role));
  const [stores, plans] = await Promise.all([
    db.store.findMany({ where: { vendor: { userId: user.id } }, select: { id: true, name: true, subscription: { include: { plan: true } } }, orderBy: { createdAt: "desc" } }),
    db.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: { monthlyPrice: "asc" } }),
  ]);
  return <VendorTheme><div className="min-h-screen bg-surface-page text-fg-body"><header className="border-b border-line bg-white"><div className="container flex items-center justify-between py-4"><BrandLogo variant="compact"/><Link href="/vendor" className="text-sm font-medium text-primary hover:text-primary-hover">Satıcı paneli</Link></div></header><main className="container py-9 sm:py-12"><VendorPageHeader eyebrow="Satıcı portalı" title="Abunəlik planları" description="Plan və qiymətlər aktiv plan qeydlərindən göstərilir. Bu səhifədə ödəniş aparılmır; inteqrasiya tamamlanana qədər yeni abunəliklər gözləyir statusunda qalır."/><section className="mt-6 grid gap-4 md:grid-cols-2">{plans.map((plan:any)=><article key={plan.id} className="rounded-card border border-line bg-white p-5"><h2 className="font-semibold">{plan.name}</h2><p className="mt-2 text-2xl font-semibold">{Number(plan.monthlyPrice).toFixed(2)} ₼ <span className="text-sm font-normal text-slate-500">/ ay</span></p>{plan.description&&<p className="mt-2 text-sm text-slate-500">{plan.description}</p>}</article>)}</section>{!plans.length&&<p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Hazırda aktiv abunəlik planı mövcud deyil.</p>}<h2 className="mt-9 font-display text-h2 text-fg">Mağazalar üzrə abunəliklər</h2>{stores.length?<div className="mt-4 grid gap-3">{stores.map((store:any)=><article key={store.id} className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-white p-5"><div><h3 className="font-semibold">{store.name}</h3>{store.subscription?<p className="mt-1 text-sm text-slate-500">{store.subscription.plan.name} · {labels[store.subscription.status]||store.subscription.status} · {Number(store.subscription.plan.monthlyPrice).toFixed(2)} ₼/ay</p>:<p className="mt-1 text-sm text-slate-500">Plan seçilməyib</p>}</div><ButtonLink href={`/vendor/${store.id}/subscription`} variant="secondary" size="sm">Planı idarə et</ButtonLink></article>)}</div>:<div className="mt-4 rounded-card border border-dashed border-line-strong bg-white p-6"><p className="text-sm text-slate-600">Abunəlik mağaza yaradılarkən seçilir.</p><ButtonLink href="/vendor/stores/new" size="sm" className="mt-3">Mağaza yarat</ButtonLink></div>}</main></div></VendorTheme>;
}
