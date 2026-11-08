import { prisma } from "@/lib/prisma";
import { filterEligiblePublicProducts, resolvePublicStoreEligibility } from "@/lib/store-eligibility";
import { publicProductVisibilityWhere, publicStoreVisibilityWhere } from "@/lib/store-visibility";
import { ProductGrid, type DisplayProduct } from "@/components/product-grid";
import { calculateEffectivePrice } from "@/lib/promotion-pricing";

export const dynamic = "force-dynamic";

export default async function DealsPage({ searchParams }: { searchParams: Promise<{ city?: string }> }) {
  const { city } = await searchParams;
  const now = new Date();
  const cityFilter = city ? { city: { isActive: true, slug: city } } : {};
  const [candidates, campaigns] = await Promise.all([
    prisma.product.findMany({
      where: { ...publicProductVisibilityWhere(city ? { city: { isActive: true, slug: city } } : undefined), discountPrice: { not: null } },
      include: { store: { select: { name: true, isActive: true, status: true, subscription: { select: { status: true, currentPeriodEnd: true, plan: { select: { slug: true, isActive: true } } } } } }, inventory: { select: { variantId: true, quantity: true, reserved: true } }, variants: { where: { isActive: true }, select: { id: true, isActive: true, inventory: { select: { quantity: true, reserved: true } } } } },
      orderBy: { updatedAt: "desc" }, take: 100,
    }),
    prisma.promotion.findMany({
      where: { storeId: { not: null }, isActive: true, startsAt: { lte: now }, endsAt: { gte: now }, store: { ...publicStoreVisibilityWhere(), ...cityFilter }, products: { some: { product: { status: "ACTIVE", OR: [{ inventory: { some: { variantId: null, quantity: { gt: 0 } } } }, { variants: { some: { isActive: true, inventory: { some: { quantity: { gt: 0 } } } } } }], store: { ...publicStoreVisibilityWhere(), ...cityFilter } } } } },
      include: {
        store: { select: { name: true, isActive: true, status: true, subscription: { select: { status: true, currentPeriodEnd: true, plan: { select: { slug: true, isActive: true } } } } } },
        products: {
          where: { product: { status: "ACTIVE", OR: [{ inventory: { some: { variantId: null, quantity: { gt: 0 } } } }, { variants: { some: { isActive: true, inventory: { some: { quantity: { gt: 0 } } } } } }], store: { ...publicStoreVisibilityWhere(), ...cityFilter } } },
          include: { product: { include: { store: { select: { id: true, name: true, isActive: true, status: true, subscription: { select: { status: true, currentPeriodEnd: true, plan: { select: { slug: true, isActive: true } } } } } }, inventory: { select: { variantId: true, quantity: true, reserved: true } }, variants: { where: { isActive: true }, select: { id: true, isActive: true, inventory: { select: { quantity: true, reserved: true } } } } } } },
        },
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: 24,
    }),
  ]);
  const [eligibleCandidates, eligibleCampaignStoreIds] = await Promise.all([
    filterEligiblePublicProducts(candidates, prisma, now),
    resolvePublicStoreEligibility(campaigns.flatMap((campaign) => campaign.storeId ? [campaign.storeId] : []), prisma, now),
  ]);
  const eligibleCampaigns = campaigns.filter((campaign) => campaign.storeId && eligibleCampaignStoreIds.has(campaign.storeId));
  const stockRows = (product: any) => product.variants.length ? product.variants.flatMap((variant: any) => variant.inventory) : product.inventory.filter((row: any) => row.variantId == null);
  const deals: DisplayProduct[] = eligibleCandidates.filter((product: any) => product.discountPrice !== null && Number(product.discountPrice) > 0 && Number(product.discountPrice) < Number(product.price));
  const promoted = new Map<string, DisplayProduct>();
  for (const campaign of eligibleCampaigns as any[]) for (const link of campaign.products) {
    const product = link.product;
    if (campaign.storeId !== product.storeId || promoted.has(product.id) || !stockRows(product).some((row: any) => row.quantity - row.reserved > 0)) continue;
    const effective = calculateEffectivePrice(product.price, product.discountPrice, [campaign], now);
    if (effective.promotion) promoted.set(product.id, { ...product, storeId: product.store.id, effectivePrice: effective.unitPrice.toFixed(2), campaignName: campaign.name });
  }
  const manualDeals = deals.filter(product => !promoted.has(product.id));
  return <div className="container py-8 sm:py-12">
    <p className="text-[.68rem] font-semibold uppercase tracking-[.18em] text-[#85621d]">Mağazaların təqdim etdiyi</p>
    <h1 className="mt-1 text-2xl font-semibold text-[#0B1726] sm:text-3xl">Endirimlər və kampaniyalar</h1>
    <p className="mt-2 max-w-2xl text-sm leading-6 text-[#667085]">Aktiv kampaniyalar və məhsul səhifələrində qeyd olunan endirimli qiymətlər.</p>
    {eligibleCampaigns.length > 0 && <section aria-labelledby="campaigns-title" className="mt-7"><h2 id="campaigns-title" className="text-lg font-semibold text-[#16202C]">Hazırda aktiv kampaniyalar</h2><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{eligibleCampaigns.map((campaign: any) => { const value = Number(campaign.discountValue); const discount = campaign.discountType === "PERCENT" && value > 0 ? `${value}% endirim` : campaign.discountType === "FIXED" && value > 0 ? `${value.toFixed(2)} ₼ endirim` : null; return <article key={campaign.id} className="rounded-2xl border border-[#E8E7E2] bg-white p-4 sm:p-5"><p className="text-[.65rem] font-semibold uppercase tracking-[.14em] text-[#85621d]">{campaign.store?.name}</p><h3 className="mt-2 font-semibold text-[#16202C]">{campaign.name}</h3>{discount && <p className="mt-1 text-sm font-medium text-[#28766f]">{discount}</p>}<p className="mt-3 text-xs text-[#667085]">{campaign.startsAt.toLocaleDateString("az-AZ")} – {campaign.endsAt.toLocaleDateString("az-AZ")}</p></article>; })}</div>{promoted.size > 0 && <div className="mt-6"><h3 className="mb-3 font-semibold">Kampaniyadakı məhsullar</h3><ProductGrid products={[...promoted.values()]}/></div>}</section>}
    <section aria-labelledby="discount-products-title" className="mt-8"><h2 id="discount-products-title" className="text-lg font-semibold text-[#16202C]">Endirimli məhsullar</h2><div className="mt-4"><ProductGrid products={manualDeals} emptyTitle="Hazırda endirimli məhsul yoxdur" emptyDetail="Mağazalar endirimli qiymət qeyd etdikdə məhsullar burada görünəcək."/></div></section>
  </div>;
}
