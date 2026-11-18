import Link from "next/link";
import { Heart, ShoppingBag } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { CategoryMegaMenu, type MegaMenuCategory } from "@/components/category-mega-menu";
import { CitySelector } from "@/components/city-selector";
import { CustomerAccountMenu } from "@/components/customer-account-menu";
import { MobileMenu } from "@/components/mobile-menu";
import { SearchForm } from "@/components/search-form";
import { StickyHeader } from "@/components/sticky-header";

type HeaderUser = { email: string; displayName: string; role: "CUSTOMER" | "VENDOR" | "ADMIN" } | null;
type HeaderCategory = MegaMenuCategory;
type HeaderCity = { id: string; name: string; slug: string };

export function Header({
  branding,
  user,
  messagesUnread = null,
  cities,
  categories,
}: {
  branding: { siteName: string; logoUrl: string | null };
  user: HeaderUser;
  messagesUnread?: number | null;
  cities: HeaderCity[];
  categories: HeaderCategory[];
}) {
  return (
    <StickyHeader>
      {/* Top bar: fixed 44 px height and one line (overflow hidden), so a font swap can never change its height. */}
      <div className="bagati-on-dark bg-surface-inverse text-white">
        <div className="container flex h-11 items-center justify-between gap-3 overflow-hidden text-xs">
          <p className="min-w-0 truncate text-white/80">Sevdiyin mağazalar və məhsullar bir məkanda.</p>
          <nav aria-label="Xidmət keçidləri" className="flex shrink-0 items-center gap-2 sm:gap-4">
            <Link href="/delivery-returns" className="inline-flex h-11 items-center whitespace-nowrap rounded-sm px-1 transition-colors hover:text-gold-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-bagati-gold">Çatdırılma</Link>
            <Link href="/help" className="inline-flex h-11 items-center whitespace-nowrap rounded-sm px-1 transition-colors hover:text-gold-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-bagati-gold">Kömək</Link>
            <Link href="/vendor/apply" className="inline-flex h-11 items-center whitespace-nowrap rounded-sm px-1 transition-colors hover:text-gold-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-bagati-gold font-semibold text-gold-200">Satıcı ol</Link>
          </nav>
        </div>
      </div>
      <div className="container">
        <div className="storefront-header-main flex min-h-[78px] items-center gap-2 transition-[min-height] duration-300 sm:gap-3 md:min-h-[88px] md:gap-5 motion-reduce:transition-none">
          <div className="md:hidden">
            <MobileMenu cities={cities} categories={categories} user={user} />
          </div>

          <span className="sm:hidden"><BrandLogo variant="icon" className="py-1" priority {...branding} /></span>
          <span className="hidden sm:inline-flex"><BrandLogo variant="full" className="py-1" priority {...branding} /></span>

          <nav aria-label="Əsas naviqasiya" className="hidden shrink-0 items-center gap-1 xl:flex">
            <CategoryMegaMenu categories={categories} />
            <Link href="/stores" className="inline-flex min-h-11 items-center rounded-full px-2 text-sm font-semibold text-fg-body transition-colors hover:bg-primary-subtle hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Mağazalar</Link>
            <Link href="/deals" className="inline-flex min-h-11 items-center rounded-full px-2 text-sm font-semibold text-fg-body transition-colors hover:bg-primary-subtle hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Endirimlər</Link>
            <Link href="/new-products" className="inline-flex min-h-11 items-center rounded-full px-2 text-sm font-semibold text-fg-body transition-colors hover:bg-primary-subtle hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Yenilər</Link>
          </nav>

          <div className="hidden min-w-0 flex-1 md:block">
            <SearchForm categories={categories} />
          </div>

          <div className="hidden shrink-0 md:block">
            <CitySelector cities={cities} />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-0 sm:gap-1">
            <Link href="/favorites" aria-label="Sevimlilər" className="grid h-11 w-11 place-items-center rounded-full text-fg-body transition-colors hover:bg-primary-subtle hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              <Heart aria-hidden="true" size={19} />
            </Link>
            <Link href="/cart" aria-label="Səbət" className="grid h-11 w-11 place-items-center rounded-full text-fg-body transition-colors hover:bg-primary-subtle hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              <ShoppingBag aria-hidden="true" size={19} />
            </Link>
            <CustomerAccountMenu user={user ? { email: user.email, displayName: user.displayName, role: user.role } : null} messagesUnread={messagesUnread} />
          </div>
        </div>

        <nav aria-label="Alış-veriş bölmələri" className="hidden border-t border-line py-1 md:flex md:items-center md:gap-3 xl:hidden">
          <CategoryMegaMenu categories={categories} />
          <Link href="/stores" className="inline-flex min-h-11 items-center rounded-full px-2 text-sm font-semibold text-fg-body transition-colors hover:bg-primary-subtle hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Mağazalar</Link>
          <Link href="/deals" className="inline-flex min-h-11 items-center rounded-full px-2 text-sm font-semibold text-fg-body transition-colors hover:bg-primary-subtle hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Endirimlər</Link>
          <Link href="/new-products" className="inline-flex min-h-11 items-center rounded-full px-2 text-sm font-semibold text-fg-body transition-colors hover:bg-primary-subtle hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Yeni məhsullar</Link>
        </nav>

        {/* Mobile: search plus the city selector (the city was only reachable inside the menu before). */}
        <div className="flex items-center gap-2 pb-3 md:hidden">
          <div className="min-w-0 flex-1"><SearchForm mobile categories={categories} /></div>
          {cities.length > 0 && <div className="shrink-0"><CitySelector cities={cities} compact /></div>}
        </div>
      </div>
    </StickyHeader>
  );
}
