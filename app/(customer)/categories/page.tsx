import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { filterEligiblePublicProducts } from "@/lib/store-eligibility";
import { publicProductVisibilityWhere } from "@/lib/store-visibility";
import { ProductGrid, type DisplayProduct } from "@/components/product-grid";
import { CategoryIcon } from "@/components/category-icon";
import { EmptyState } from "@/components/state-panel";
import { calculateEffectivePrice, productPromotions } from "@/lib/promotion-pricing";
import { categoriesWithOtherLast } from "@/lib/category-order";
export const dynamic = "force-dynamic";
export default async function CategoriesPage({ searchParams }: { searchParams: Promise<{ category?: string; city?: string }> }) {
  const { category: slug, city } = await searchParams;
  const now = new Date();
  const [categoryRows, selected] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true, parentId: null }, include: { children: { where: { isActive: true }, orderBy: { name: "asc" } } }, orderBy: { name: "asc" } }),
    slug ? prisma.category.findFirst({ where: { slug, isActive: true }, select: { id: true, name: true, slug: true } }) : Promise.resolve(null),
  ]) as [{id:string;name:string;slug:string;children:{id:string;name:string;slug:string}[]}[], {id:string;name:string;slug:string}|null];
  const categories = categoriesWithOtherLast(categoryRows.map((category) => ({
    ...category,
    children: categoriesWithOtherLast(category.children),
  })));
  const productRows = (selected ? await prisma.product.findMany({ where: { ...publicProductVisibilityWhere(city ? { city: { isActive: true, slug: city } } : undefined), categoryId: selected.id }, include: { store: { select: { id: true, name: true, isActive: true, status: true, subscription: { select: { status: true, currentPeriodEnd: true, plan: { select: { slug: true, isActive: true } } } } } }, inventory: { select: { variantId: true, quantity: true, reserved: true } }, variants: { where: { isActive: true }, select: { id: true, isActive: true, inventory: { select: { quantity: true, reserved: true } } } }, promotionProducts: { include: { promotion: true } } }, orderBy: { createdAt: "desc" }, take: 16 }) : null);
  const eligibleProductRows = productRows ? await filterEligiblePublicProducts(productRows, prisma, now) : null;
  const products = eligibleProductRows?.map((product: any) => { const effective=calculateEffectivePrice(product.price,product.discountPrice,productPromotions(product.promotionProducts,product.store.id),now); return {...product,storeId:product.store.id,effectivePrice:effective.unitPrice.toFixed(2),campaignName:effective.promotion?.name||null}; }) || null;
  return <main className="container py-8 sm:py-10 md:py-14">
    <header className="max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald">BAGATI kataloqu</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink md:text-4xl">Kateqoriyalar</h1>
      <p className="mt-3 text-sm leading-6 text-muted sm:text-base">Mağazalarda təqdim olunan kateqoriyalar arasından axtardığınızı seçin.</p>
    </header>
    {categories.length ? <div className="mt-7 grid grid-cols-2 gap-3 sm:mt-8 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">{categories.map((item) => {
      const selectedCategory = slug === item.slug;
      return <section key={item.id} className={`group rounded-[22px] border p-3 transition duration-200 sm:p-5 motion-reduce:transition-none ${selectedCategory ? "border-[#c7ad76] bg-[#fbf8f0] shadow-[0_8px_24px_rgba(23,58,58,.07)]" : "border-line bg-white hover:-translate-y-0.5 hover:border-[#c5d3cb] hover:shadow-[0_12px_28px_rgba(23,58,58,.09)]"}`}>
        <Link href={`/categories?category=${item.slug}${city ? `&city=${city}` : ""}`} aria-current={selectedCategory ? "page" : undefined} className="flex min-h-[136px] flex-col items-start justify-between gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 sm:min-h-[148px]">
          <CategoryIcon category={item} size="large" />
          <span className="flex w-full min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 font-semibold leading-5 text-ink">{item.name}</span>
            <span aria-hidden="true" className="text-lg text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-emerald">›</span>
          </span>
        </Link>
        {item.children.length > 0 && <div className="mt-4 flex flex-wrap gap-2 border-t border-line/70 pt-3">{item.children.map((child) => <Link key={child.id} href={`/categories?category=${child.slug}${city ? `&city=${city}` : ""}`} className="inline-flex min-h-9 items-center rounded-full bg-paper px-3 text-xs font-medium text-muted transition-colors hover:bg-[#edf1ed] hover:text-emerald focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald">{child.name}</Link>)}</div>}
      </section>;
    })}</div> : <div className="mt-6 rounded-2xl border border-line bg-white px-5 py-6 sm:px-6"><EmptyState title="Kateqoriyalar əlavə olunur" detail="Məhsullar kateqoriyalara ayrıldıqca burada görünəcək."/></div>}
    {selected && products && <section className="mt-14"><div className="flex items-end justify-between"><div><p className="text-xs uppercase tracking-[.18em] text-emerald">Kateqoriya</p><h2 className="mt-2 text-2xl font-semibold">{selected.name}</h2></div><Link href={`/products?category=${selected.slug}${city?`&city=${city}`:""}`} className="text-sm text-emerald">Bütün məhsullara bax →</Link></div><div className="mt-6"><ProductGrid products={products as DisplayProduct[]} emptyTitle="Bu kateqoriyada məhsul yoxdur" emptyDetail="Başqa kateqoriyalara baxa bilərsiniz."/></div></section>}
  </main>;
}
