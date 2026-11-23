import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { CategoryMegaMenu, type MegaMenuCategory } from "@/components/category-mega-menu";
import { CitySelector } from "@/components/city-selector";
import { CustomerAccountMenu } from "@/components/customer-account-menu";
import { MobileMenu } from "@/components/mobile-menu";
import { SearchForm } from "@/components/search-form";
import { StickyHeader } from "@/components/sticky-header";
import { HeaderCartLink, HeaderFavoritesLink, HeaderNavLink } from "@/components/header-actions";

type HeaderUser = { email: string; displayName: string; role: "CUSTOMER" | "VENDOR" | "ADMIN" } | null;
type HeaderCategory = MegaMenuCategory;
type HeaderCity = { id: string; name: string; slug: string };

export function Header({
  branding,
  user,
  messagesUnread = null,
  cartCount = null,
  cities,
  categories,
}: {
  branding: { siteName: string; logoUrl: string | null };
  user: HeaderUser;
  messagesUnread?: number | null;
  /** Lines in the signed-in customer's cart; null for guests and other roles (no badge). */
  cartCount?: number | null;
  cities: HeaderCity[];
  categories: HeaderCategory[];
}) {
  return (
    <StickyHeader>
      {/* Top bar: fixed 44 px height and one line (overflow hidden), so a font swap can never change its height. */}
      <div className="bagati-on-dark bg-surface-inverse text-white">
        <div className="container flex h-11 items-center justify-between gap-3 overflow-hidden text-xs md:text-sm">
          <p className="min-w-0 truncate text-white/85">Sevdiyin mağazalar və məhsullar bir məkanda.</p>
          <nav aria-label="Xidmət keçidləri" className="flex shrink-0 items-center gap-2 sm:gap-4">
            <Link href="/delivery-returns" className="inline-flex h-11 items-center whitespace-nowrap rounded-sm px-1 font-medium underline-offset-4 transition-colors hover:text-gold-200 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-bagati-gold">Çatdırılma</Link>
            <Link href="/help" className="inline-flex h-11 items-center whitespace-nowrap rounded-sm px-1 font-medium underline-offset-4 transition-colors hover:text-gold-200 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-bagati-gold">Kömək</Link>
            <Link href="/vendor/apply" className="inline-flex h-11 items-center whitespace-nowrap rounded-sm px-1 font-medium underline-offset-4 transition-colors hover:text-gold-200 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-bagati-gold font-semibold text-gold-200">Satıcı ol</Link>
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

          <div className="hidden min-w-0 flex-1 md:block">
            <SearchForm categories={categories} />
          </div>

          {/* From 1024 px the city sits next to search; at 768-1023 px it moves to the section row below, so search gets the room (DESIGN-T7). */}
          <div className="hidden shrink-0 lg:block">
            <CitySelector cities={cities} />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-0 sm:gap-1">
            <HeaderFavoritesLink />
            <HeaderCartLink initialCount={cartCount} />
            <CustomerAccountMenu user={user ? { email: user.email, displayName: user.displayName, role: user.role } : null} messagesUnread={messagesUnread} />
          </div>
        </div>

        {/* Section links live in this second row at every desktop width, so the search field keeps its width next to the city and account controls. */}
        <nav aria-label="Alış-veriş bölmələri" className="hidden border-t border-line py-1 md:flex md:items-center md:gap-1">
          <CategoryMegaMenu categories={categories} />
          <HeaderNavLink href="/stores">Mağazalar</HeaderNavLink>
          <HeaderNavLink href="/deals">Endirimlər</HeaderNavLink>
          <HeaderNavLink href="/new-products">Yeni məhsullar</HeaderNavLink>
          {cities.length > 0 && <div data-header-city-tablet="" className="ml-auto shrink-0 lg:hidden"><CitySelector cities={cities} /></div>}
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
