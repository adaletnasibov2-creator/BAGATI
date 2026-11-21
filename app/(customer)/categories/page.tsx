import Link from "next/link";
import { productCardSelect } from "@/lib/product-card-select";
import { prisma } from "@/lib/prisma";
import { filterEligiblePublicProducts } from "@/lib/store-eligibility";
import { publicProductVisibilityWhere } from "@/lib/store-visibility";
import { ProductGrid, type DisplayProduct } from "@/components/product-grid";
import { CategoryIcon } from "@/components/category-icon";
import { EmptyState } from "@/components/state-panel";
import { calculateEffectivePrice, productPromotions } from "@/lib/promotion-pricing";
import { getPublicCategoryData } from "@/lib/public-category-tree";
import { categoryBreadcrumbs, categoryHref, categorySiblingLinks, findCategoryBySlug, isPublicCategory } from "@/lib/category-tree";
import { CategoryEmptyState } from "@/components/category-empty-state";
import { categoryScopeWhere } from "@/lib/category-where";
import { categorySharePreviewMetadata } from "@/lib/share-preview";
import { getSiteSettings } from "@/lib/site-settings";
import { CategoryGlyph } from "@/components/category-icon";
import { CategoryBreadcrumbs } from "@/components/category-breadcrumbs";
import type { Metadata } from "next";
export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<{ category?: string; city?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { category: slug } = await searchParams;
  if (!slug) return { title: "Kateqoriyalar", description: "BAGATI kataloqunun bütün kateqoriyaları və alt kateqoriyaları." };
  const [data, settings] = await Promise.all([getPublicCategoryData(), getSiteSettings()]);
  const lookup = findCategoryBySlug(data.rows, slug);
  // A deactivated category is "not found" publicly: its name never appears in the title.
  const found = lookup && isPublicCategory(data.rows, lookup.category.id) ? lookup : null;
  const visibleCount = found ? data.tree.flatMap((top) => [top, ...top.children]).find((node) => node.id === found.category.id)?.count ?? 0 : 0;
  // Canonical points at the clean /products?category=<slug> URL for the same listing.
  // SMALL-FIXES-1 D: + share preview (og/twitter) for a public category only; a hidden one stays bare.
  return categorySharePreviewMetadata({ category: found?.category ?? null, parent: found?.parent ?? null, visibleCount, siteName: settings.siteName });
}

export default async function CategoriesPage({ searchParams }: Props) {
  const { category: slug, city } = await searchParams;
  const now = new Date();
  // Only categories with visible products (same rules as the product list); empty ones are hidden.
  const data = await getPublicCategoryData(city || null);
  const categories = data.tree;
  const found = findCategoryBySlug(data.rows, slug);
  const selected = found && found.category.isActive && (!found.parent || found.parent.isActive) ? found.category : null;
  // A top-level lists itself and its subcategories; a subcategory only itself.
  const productRows = (selected ? await prisma.product.findMany({ where: { ...publicProductVisibilityWhere(city ? { city: { isActive: true, slug: city } } : undefined), category: categoryScopeWhere(selected.slug) }, select: productCardSelect(now) /* only what the cards render (SCALE-FIX-2 A5) */, orderBy: { createdAt: "desc" }, take: 16 }) : null);
  const eligibleProductRows = productRows ? await filterEligiblePublicProducts(productRows, prisma, now) : null;
  const products = eligibleProductRows?.map((product: any) => { const effective=calculateEffectivePrice(product.price,product.discountPrice,productPromotions(product.promotionProducts,product.store.id),now); return {...product,storeId:product.store.id,effectivePrice:effective.unitPrice.toFixed(2),campaignName:effective.promotion?.name||null}; }) || null;
  return <main className="container py-8 sm:py-10 md:py-14">
    <header className="max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald">BAGATI kataloqu</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink md:text-4xl">Kateqoriyalar</h1>
      <p className="mt-3 text-sm leading-6 text-muted sm:text-base">Mağazalarda təqdim olunan kateqoriyalar arasından axtardığınızı seçin.</p>
    </header>
    {categories.length ? <div className="mt-7 grid grid-cols-2 gap-3 sm:mt-8 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">{categories.map((item) => {
      const selectedCategory = slug === item.slug || item.children.some((child) => child.slug === slug);
      return <section key={item.id} className={`group rounded-[22px] border p-3 transition duration-200 sm:p-5 motion-reduce:transition-none ${selectedCategory ? "border-[#c7ad76] bg-[#fbf8f0] shadow-[0_8px_24px_rgba(23,58,58,.07)]" : "border-line bg-white hover:-translate-y-0.5 hover:border-[#c5d3cb] hover:shadow-[0_12px_28px_rgba(23,58,58,.09)]"}`}>
        <Link href={`/categories?category=${item.slug}${city ? `&city=${city}` : ""}`} aria-current={selectedCategory ? "page" : undefined} className="flex min-h-[136px] flex-col items-start justify-between gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 sm:min-h-[148px]">
          <CategoryIcon category={item} size="large" />
          <span className="flex w-full min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 font-semibold leading-5 text-ink">{item.name}</span>
            <span aria-hidden="true" className="text-lg text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-emerald">›</span>
          </span>
        </Link>
        {item.children.length > 0 && <div className="mt-4 flex flex-wrap gap-2 border-t border-line/70 pt-3">{item.children.map((child) => <Link key={child.id} href={`/categories?category=${child.slug}${city ? `&city=${city}` : ""}`} aria-current={slug === child.slug ? "page" : undefined} className={`inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald ${slug === child.slug ? "bg-ink text-white" : "bg-paper text-muted hover:bg-[#edf1ed] hover:text-emerald"}`}><CategoryGlyph category={child} size={14} /><span className="truncate">{child.name}</span>{child.count ? <span className="opacity-70">{child.count}</span> : null}</Link>)}</div>}
      </section>;
    })}</div> : <div className="mt-6 rounded-2xl border border-line bg-white px-5 py-6 sm:px-6"><EmptyState title="Kateqoriyalar əlavə olunur" detail="Məhsullar kateqoriyalara ayrıldıqca burada görünəcək."/></div>}
    {selected && products && <section className="mt-14"><CategoryBreadcrumbs crumbs={categoryBreadcrumbs(selected, found?.parent ?? null, (parentSlug) => `/categories?category=${parentSlug}${city ? `&city=${city}` : ""}`)} className="mb-3" /><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs uppercase tracking-[.18em] text-emerald">Kateqoriya</p><h2 className="mt-2 text-2xl font-semibold">{selected.name}</h2></div><Link href={`${categoryHref(selected.slug)}${city?`&city=${city}`:""}`} className="text-sm text-emerald">Bütün məhsullara bax →</Link></div><div className="mt-6">{products.length ? <ProductGrid products={products as DisplayProduct[]} emptyTitle="Bu kateqoriyada məhsul yoxdur" emptyDetail="Başqa kateqoriyalara baxa bilərsiniz."/> : <CategoryEmptyState links={categorySiblingLinks(categories, selected.id)} hrefFor={(slug) => `/categories?category=${slug}${city ? `&city=${city}` : ""}`} />}</div></section>}
  </main>;
}
