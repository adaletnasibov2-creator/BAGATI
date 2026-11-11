import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { CategoryIcon, categoryKind } from "@/components/category-icon";
import { CategoryMegaMenu } from "@/components/category-mega-menu";
import { CategoryNavigation } from "@/components/category-navigation";
import { HeroCarousel } from "@/components/home/hero-carousel";
import { MobileMenu } from "@/components/mobile-menu";
import { ProductCard } from "@/components/product-card";
import { categoriesWithOtherLast } from "@/lib/category-order";

// Database-free visual check of the storefront. The list mirrors the marketplace taxonomy in
// prisma/seed.ts (same names and slugs) so every tile below goes through the same shared
// name/slug mapping as the live pages. Nothing here is written to or read from the database.
const categories = categoriesWithOtherLast([
  { id: "elektronika", name: "Elektronika", slug: "elektronika" },
  { id: "geyim", name: "Geyim", slug: "geyim" },
  { id: "ev-ve-mesiet", name: "Ev və məişət", slug: "ev-ve-mesiet" },
  { id: "eylence", name: "Əyləncə", slug: "eylence" },
  { id: "idman", name: "İdman", slug: "idman" },
  { id: "usaq", name: "Uşaq", slug: "usaq" },
  { id: "gozellik", name: "Gözəllik", slug: "gozellik" },
  { id: "aksesuarlar", name: "Aksesuarlar", slug: "aksesuarlar" },
  { id: "supermarket", name: "Supermarket", slug: "supermarket" },
  { id: "diger", name: "Digər", slug: "diger" },
]);

// Kinds the shared mapping also recognises. They are not part of the seeded taxonomy and are
// shown only so their photographs can be checked if such a category is ever created.
const additionalMappings = [
  { id: "avtomobil", name: "Avtomobil", slug: "avtomobil" },
  { id: "kitablar", name: "Kitablar", slug: "kitablar" },
  { id: "ev-heyvanlari", name: "Ev heyvanları", slug: "ev-heyvanlari" },
];

const products = [
  { id: "p1", name: "Lüks Smartfon Pro", price: "799.00", originalPrice: "999.00", image: "/images/home/hero-electronics-devices-mobile.webp", store: "Tech House", storeId: "s1" },
  { id: "p2", name: "Premium Dəri Çanta", price: "249.00", originalPrice: "349.00", image: "/images/home/hero-fashion-collection.webp", store: "Aksesuar Atelier", storeId: "s2" },
  { id: "p3", name: "Modern Otaq Lampa", price: "129.00", originalPrice: "169.00", image: "/images/home/hero-home.webp", store: "Ev & Form", storeId: "s3" },
  { id: "p4", name: "Minimal Geyim dəsti", price: "189.00", originalPrice: "229.00", image: "/images/home/hero-fashion-collection.webp", store: "Moda Nizam", storeId: "s4" },
];

export const dynamic = "force-dynamic";

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-4">
      <p className="text-[.65rem] font-semibold uppercase tracking-[.16em] text-bagati-muted">{eyebrow}</p>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight text-bagati-text">{title}</h2>
    </div>
  );
}

// Sample data only: never served to real shoppers. Set BAGATI_ENABLE_PREVIEW_ROUTES=true on a staging host to view it.
export const metadata = { robots: { index: false, follow: false } };

export default function StorefrontPreviewPage() {
  if (process.env.NODE_ENV === "production" && process.env.BAGATI_ENABLE_PREVIEW_ROUTES !== "true") notFound();
  return (
    <main className="min-h-screen bg-bagati-page text-bagati-text">
      <header className="relative z-40 border-b border-bagati-border bg-white">
        <div className="container flex items-center justify-between gap-4 py-3">
          <div className="flex items-center gap-3">
            <Suspense fallback={null}>
              <MobileMenu cities={[]} categories={categories} user={null} />
            </Suspense>
            <div className="font-serif text-2xl text-bagati-deep">BAGATI</div>
          </div>
          <nav className="hidden items-center gap-6 text-sm font-medium text-bagati-secondary md:flex" data-preview="mega-menu">
            <CategoryMegaMenu categories={categories} />
            <Link href="/stores">Mağazalar</Link>
            <Link href="/deals">Endirimlər</Link>
          </nav>
          <div className="rounded-full border border-bagati-border bg-bagati-section px-4 py-2 text-sm font-medium text-bagati-deep">Səbət · 2</div>
        </div>
      </header>

      <section className="container pb-6 pt-3 sm:pb-8 sm:pt-5" data-preview="hero">
        <HeroCarousel />
      </section>

      {/* Same markup as the homepage catalog in app/(customer)/page.tsx. */}
      <section className="container pb-6 sm:pb-8" data-preview="home-catalog">
        <div className="mb-4 flex items-end justify-between gap-3">
          <SectionHeading eyebrow="BAGATI kataloqu" title="Nə axtarırsan?" />
          <Link href="/categories" className="inline-flex min-h-10 shrink-0 items-center gap-1 text-xs font-semibold text-bagati-text sm:text-sm">
            Hamısına bax<ChevronRight aria-hidden="true" size={15} />
          </Link>
        </div>
        <nav aria-label="Məhsul kateqoriyaları" className="-mx-3 flex snap-x gap-2.5 overflow-x-auto px-3 pb-2 sm:mx-0 sm:grid sm:grid-cols-5 sm:gap-3 sm:px-0 lg:grid-cols-10">
          {categories.map((category) => (
            <Link key={category.id} href={`/products?category=${encodeURIComponent(category.slug)}`} className="group flex min-h-[142px] min-w-[108px] shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-[20px] border border-bagati-border bg-white px-2 py-3 text-center shadow-[0_6px_18px_rgba(23,58,58,.035)] outline-none transition duration-200 hover:-translate-y-0.5 hover:border-[#C9D8D1] hover:shadow-card focus-visible:ring-2 focus-visible:ring-bagati-gold focus-visible:ring-offset-2 motion-reduce:transition-none sm:min-w-0">
              <CategoryIcon category={category} size="large" />
              <span className="line-clamp-2 min-h-8 max-w-[104px] text-[.74rem] font-semibold leading-4 text-bagati-text sm:text-[.78rem]">{category.name}</span>
            </Link>
          ))}
        </nav>
      </section>

      <section className="container pb-6 sm:pb-8" data-preview="category-navigation">
        <SectionHeading eyebrow="CategoryNavigation" title="Kateqoriya naviqasiyası" />
        <CategoryNavigation categories={categories} />
      </section>

      {/* Same markup as the listing grid in app/(customer)/categories/page.tsx. */}
      <section className="container pb-6 sm:pb-8" data-preview="category-listing">
        <SectionHeading eyebrow="/categories" title="Kateqoriyalar" />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {categories.map((item) => (
            <section key={item.id} className="group rounded-[22px] border border-line bg-white p-3 transition duration-200 hover:-translate-y-0.5 hover:border-[#c5d3cb] hover:shadow-[0_12px_28px_rgba(23,58,58,.09)] motion-reduce:transition-none sm:p-5">
              <Link href={`/categories?category=${item.slug}`} className="flex min-h-[136px] flex-col items-start justify-between gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 sm:min-h-[148px]">
                <CategoryIcon category={item} size="large" />
                <span className="flex w-full min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 font-semibold leading-5 text-ink">{item.name}</span>
                  <span aria-hidden="true" className="text-lg text-muted">›</span>
                </span>
              </Link>
            </section>
          ))}
        </div>
      </section>

      <section className="container pb-6 sm:pb-8" data-preview="additional-mappings">
        <SectionHeading eyebrow="Canlı kateqoriya deyil" title="Xəritədə dəstəklənən əlavə növlər" />
        <div className="flex flex-wrap gap-3">
          {additionalMappings.map((category) => (
            <div key={category.id} className="flex min-w-[150px] items-center gap-3 rounded-2xl border border-dashed border-bagati-border bg-white p-3 text-sm font-medium">
              <CategoryIcon category={category} size="medium" />
              <span>
                {category.name}
                <span className="block text-xs font-normal text-bagati-muted">{categoryKind(category)}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="container pb-10" data-preview="products">
        <SectionHeading eyebrow="BAGATI seçimi" title="Seçilmiş məhsullar" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              id={product.id}
              name={product.name}
              price={product.price}
              originalPrice={product.originalPrice}
              store={product.store}
              storeHref={`/stores/${product.storeId}`}
              image={product.image}
              secondaryImage={product.image}
              badge="Yeni"
              stock={12}
              lowStockThreshold={5}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
