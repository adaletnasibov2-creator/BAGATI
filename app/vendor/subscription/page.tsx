import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const db: any = prisma;
const labels: Record<string, string> = { PENDING: "Ödəniş gözləyir", ACTIVE: "Aktiv", PAST_DUE: "Ödəniş gecikib", SUSPENDED: "Dayandırılıb", CANCELLED: "Ləğv edilib", EXPIRED: "Bitib" };

export default async function VendorSubscriptionsPage() {
  const user = await currentUser();
  if (!user || user.role !== "VENDOR") redirect("/vendor/login");
  const [stores, plans] = await Promise.all([
    db.store.findMany({ where: { vendor: { userId: user.id } }, select: { id: true, name: true, subscription: { include: { plan: true } } }, orderBy: { createdAt: "desc" } }),
    db.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: { monthlyPrice: "asc" } }),
  ]);
  return <div className="min-h-screen bg-[#F7F5EF] text-[#16202C]"><header className="border-b border-[#E8E7E2] bg-white"><div className="container flex items-center justify-between py-4"><BrandLogo variant="compact"/><Link href="/vendor" className="text-sm text-[#85621d]">Satıcı paneli</Link></div></header><main className="container py-9 sm:py-12"><p className="text-xs font-semibold uppercase tracking-[.18em] text-[#85621d]">Satıcı portalı</p><h1 className="mt-2 text-3xl font-semibold text-[#0B1726]">Abunəlik planları</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#667085]">Plan və qiymətlər aktiv plan qeydlərindən göstərilir. Bu səhifədə ödəniş aparılmır; inteqrasiya tamamlanana qədər yeni abunəliklər gözləyir statusunda qalır.</p><section className="mt-6 grid gap-4 md:grid-cols-2">{plans.map((plan:any)=><article key={plan.id} className="rounded-2xl border border-[#E8E7E2] bg-white p-5"><h2 className="font-semibold">{plan.name}</h2><p className="mt-2 text-2xl font-semibold">{Number(plan.monthlyPrice).toFixed(2)} ₼ <span className="text-sm font-normal text-slate-500">/ ay</span></p>{plan.description&&<p className="mt-2 text-sm text-slate-500">{plan.description}</p>}</article>)}</section>{!plans.length&&<p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Hazırda aktiv abunəlik planı mövcud deyil.</p>}<h2 className="mt-9 text-xl font-semibold">Mağazalar üzrə abunəliklər</h2>{stores.length?<div className="mt-4 grid gap-3">{stores.map((store:any)=><article key={store.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#E8E7E2] bg-white p-5"><div><h3 className="font-semibold">{store.name}</h3>{store.subscription?<p className="mt-1 text-sm text-slate-500">{store.subscription.plan.name} · {labels[store.subscription.status]||store.subscription.status} · {Number(store.subscription.plan.monthlyPrice).toFixed(2)} ₼/ay</p>:<p className="mt-1 text-sm text-slate-500">Plan seçilməyib</p>}</div><Link href={`/vendor/${store.id}/subscription`} className="rounded-lg border border-[#ded9cf] px-4 py-2 text-sm">Planı idarə et</Link></article>)}</div>:<div className="mt-4 rounded-2xl border border-dashed border-[#d8d1c4] bg-white p-6"><p className="text-sm text-slate-600">Abunəlik mağaza yaradılarkən seçilir.</p><Link href="/vendor/stores/new" className="mt-3 inline-block rounded-lg bg-[#173c40] px-4 py-2.5 text-sm text-white">Mağaza yarat</Link></div>}</main></div>;
}
