import { prisma } from "@/lib/prisma";
import { filterEligiblePublicProducts } from "@/lib/store-eligibility";
import { publicProductVisibilityWhere } from "@/lib/store-visibility";
import { ProductGrid, type DisplayProduct } from "@/components/product-grid";
import { calculateEffectivePrice, productPromotions } from "@/lib/promotion-pricing";
export const dynamic = "force-dynamic";
export default async function NewProductsPage({ searchParams }: { searchParams: Promise<{ city?: string }> }) {
  const { city } = await searchParams;
  const now = new Date();
  const rows = await prisma.product.findMany({ where: publicProductVisibilityWhere(city ? { city: { isActive: true, slug: city } } : undefined), include: { store: { select: { id: true, name: true, isActive: true, status: true, subscription: { select: { status: true, currentPeriodEnd: true, plan: { select: { slug: true, isActive: true } } } } } }, inventory: { select: { variantId: true, quantity: true, reserved: true } }, variants: { where: { isActive: true }, select: { id: true, isActive: true, inventory: { select: { quantity: true, reserved: true } } } }, promotionProducts: { include: { promotion: true } } }, orderBy: { createdAt: "desc" }, take: 48 });
  const eligibleRows = await filterEligiblePublicProducts(rows, prisma, now);
  const products = eligibleRows.map((product: any) => { const effective=calculateEffectivePrice(product.price,product.discountPrice,productPromotions(product.promotionProducts,product.store.id),now); return {...product,storeId:product.store.id,effectivePrice:effective.unitPrice.toFixed(2),campaignName:effective.promotion?.name||null} }) as DisplayProduct[];
  return <div className="container py-10 md:py-14"><p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald">Kataloqa son əlavə olunanlar</p><h1 className="mt-2 text-3xl font-semibold text-ink md:text-4xl">Yeni məhsullar</h1><p className="mt-3 text-muted">Məhsullar əlavə olunduğu tarixə görə sıralanır.</p><div className="mt-8"><ProductGrid products={products} emptyTitle="Yeni məhsul yoxdur"/></div></div>;
}
