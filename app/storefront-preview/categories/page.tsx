import { Suspense } from "react";
import { PRODUCT_GRID_WITH_SIDEBAR_CLASS } from "@/components/product-layout";
import { notFound } from "next/navigation";
import { Header } from "@/components/header";
import { CategoryBreadcrumbs } from "@/components/category-breadcrumbs";
import { CategoryFilterTree } from "@/components/category-filter-tree";
import { CategoryPicker } from "@/components/category-picker";
import AdminCategoryManager, { type AdminCategoryNode } from "@/components/admin-category-manager";
import AdminCategoryProductMove from "@/components/admin-category-product-move";
import { ProductCard } from "@/components/product-card";
import { categoryBreadcrumbs, categoryHref, findCategoryBySlug } from "@/lib/category-tree";
import { previewCategoryRows, previewCategoryTree } from "@/lib/category-preview-data";

/**
 * Database-free visual check of the category tree UI with sample data (no reads or writes): a category page with
 * the tree filter and breadcrumbs (?category=<slug>), the seller picker, the admin tree and the bulk move table.
 * Buttons that call APIs do nothing useful here. Same production gate as /storefront-preview.
 */
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

const sampleProducts = [
  { id: "p1", name: "Lüks Smartfon Pro", price: "799.00", image: "/images/home/hero-electronics-devices-mobile.webp", store: "Tech House" },
  { id: "p2", name: "Premium Dəri Çanta", price: "249.00", image: "/images/home/hero-fashion-collection.webp", store: "Aksesuar Atelier" },
  { id: "p3", name: "Modern Otaq Lampa", price: "129.00", image: "/images/home/hero-home.webp", store: "Ev & Form" },
];

export default async function CategoryPreviewPage({ searchParams }: { searchParams: Promise<{ category?: string; view?: string }> }) {
  if (process.env.NODE_ENV === "production" && process.env.BAGATI_ENABLE_PREVIEW_ROUTES !== "true") notFound();
  const { category = "elektronika", view = "page" } = await searchParams;
  const found = findCategoryBySlug(previewCategoryRows, category);
  const href = (slug: string | null) => `/storefront-preview/categories${slug ? `?category=${slug}` : ""}`;
  // The filter tree is a client component (SCALE-FIX-3): it gets the same links as a path plus kept parameters.
  const filterLink = { path: "/storefront-preview/categories", params: [] as [string, string][] };

  if (view === "header") {
    // The real storefront header (same component as the customer layout) with the sample tree.
    return <div className="min-h-screen bg-bagati-page">
      <Suspense fallback={null}><Header branding={{ siteName: "BAGATI", logoUrl: null }} user={null} cities={[{ id: "qazax", name: "Qazax", slug: "qazax" }]} categories={previewCategoryTree} /></Suspense>
      <div className="container py-10"><div className="h-[520px] rounded-[28px] bg-[#173A3A]" /></div>
    </div>;
  }
  if (view === "seller") {
    return <main className="min-h-screen bg-[#f6f4ef] p-4 sm:p-8">
      <section className="mx-auto max-w-4xl rounded-2xl border border-[#e9e4da] bg-white p-5" data-preview="seller-picker">
        <h1 className="mb-4 text-xl font-semibold">Yeni məhsul · kateqoriya</h1>
        <div className="grid gap-4 sm:grid-cols-2"><CategoryPicker categories={previewCategoryRows} name initialId={found?.category.parentId ? found.category.id : null} /></div>
      </section>
    </main>;
  }
  if (view === "admin" || view === "move") {
    const tree: AdminCategoryNode[] = previewCategoryTree.map((top, index) => ({
      ...top, isActive: top.slug !== "hediyye-ve-bayram", sortOrder: (index + 1) * 10, productCount: index % 3 === 0 ? 4 : 0, totalCount: top.count, visibleCount: top.count - 1, childCount: top.children.length,
      children: top.children.map((child, childIndex) => ({ ...child, isActive: true, sortOrder: (childIndex + 1) * 10, productCount: child.count, totalCount: child.count, visibleCount: child.count, childCount: 0 })),
    }));
    return <main className="min-h-screen bg-[#f6f4ef] p-4 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-6 text-3xl font-semibold text-[#0d1b2a]">{view === "admin" ? "Kateqoriyalar" : "Məhsulları köçür"}</h1>
        {view === "admin" ? <AdminCategoryManager tree={tree.slice(0, 4)} /> : <AdminCategoryProductMove
          fromCategoryId="elektronika"
          groups={[{ id: "elektronika", name: "Elektronika", options: previewCategoryTree[1].children.map((child) => ({ id: child.id, name: child.name })) }]}
          products={sampleProducts.map((product, index) => ({ id: product.id, name: product.name, sku: `SKU-${index + 1}`, status: "Aktiv", store: product.store, version: new Date(0).toISOString() }))}
        />}
      </div>
    </main>;
  }
  return <main className="min-h-screen bg-bagati-page">
    <div className="container py-10">
      {found && <CategoryBreadcrumbs crumbs={categoryBreadcrumbs(found.category, found.parent, (slug) => href(slug))} className="mb-4" />}
      <p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald">BAGATI kataloqu</p>
      <h1 className="mt-2 text-3xl font-semibold text-ink md:text-4xl">{found?.category.name ?? "Məhsullar"}</h1>
      <p className="mt-2 text-xs text-muted">Kanonik ünvan: {found ? categoryHref(found.category.slug) : "/products"}</p>
      <details className="mt-5 lg:hidden"><summary className="flex min-h-11 cursor-pointer items-center rounded-xl border border-line bg-white px-4 text-sm font-medium">Kateqoriyalar{found ? `: ${found.category.name}` : ""}</summary><div className="mt-2"><CategoryFilterTree tree={previewCategoryTree} selectedSlug={found?.category.slug ?? null} link={filterLink} /></div></details>
      <div className="lg:mt-8 lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-6">
        <aside className="hidden lg:block" data-preview="filter-tree"><CategoryFilterTree tree={previewCategoryTree} selectedSlug={found?.category.slug ?? null} link={filterLink} /></aside>
        <div className={`mt-8 min-w-0 lg:mt-0 ${PRODUCT_GRID_WITH_SIDEBAR_CLASS}`}>
          {sampleProducts.map((product) => <ProductCard key={product.id} id={product.id} name={product.name} price={product.price} store={product.store} storeHref="#" image={product.image} stock={3} />)}
        </div>
      </div>
    </div>
  </main>;
}
