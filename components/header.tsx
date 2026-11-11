import Link from "next/link";
import { Heart, ShoppingBag } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { CategoryMegaMenu } from "@/components/category-mega-menu";
import { CitySelector } from "@/components/city-selector";
import { CustomerAccountMenu } from "@/components/customer-account-menu";
import { MobileMenu } from "@/components/mobile-menu";
import { SearchForm } from "@/components/search-form";
import { StickyHeader } from "@/components/sticky-header";

type HeaderUser = { email: string; displayName: string; role: "CUSTOMER" | "VENDOR" | "ADMIN" } | null;
type HeaderCategory = { id: string; name: string; slug: string };
type HeaderCity = { id: string; name: string; slug: string };

export function Header({
  branding,
  user,
  cities,
  categories,
}: {
  branding: { siteName: string; logoUrl: string | null };
  user: HeaderUser;
  cities: HeaderCity[];
  categories: HeaderCategory[];
}) {
  return (
    <StickyHeader>
      <div className="bg-[#173A3A] text-[#F6F7F4]">
        <div className="container flex min-h-9 items-center justify-between gap-2 text-[.65rem] sm:text-[.72rem]">
          <p className="min-w-0 truncate">Sevdiyin mağazalar və məhsullar bir məkanda.</p>
          <nav aria-label="Xidmət keçidləri" className="flex shrink-0 items-center gap-3 sm:gap-4">
            <Link href="/delivery-returns" className="rounded-sm transition-colors hover:text-[#E8D7B7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52]">Çatdırılma</Link>
            <Link href="/help" className="rounded-sm transition-colors hover:text-[#E8D7B7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52]">Kömək</Link>
            <Link href="/vendor/apply" className="rounded-sm font-semibold transition-colors hover:text-[#E8D7B7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52]">Satıcı ol</Link>
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

          <nav aria-label="Əsas naviqasiya" className="hidden shrink-0 items-center gap-4 xl:flex">
            <CategoryMegaMenu categories={categories} />
            <Link href="/stores" className="rounded-sm text-[.84rem] font-semibold text-[#405451] transition-colors hover:text-[#2F6F68] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#4F8175]">Mağazalar</Link>
            <Link href="/deals" className="rounded-sm text-[.84rem] font-semibold text-[#405451] transition-colors hover:text-[#2F6F68] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#4F8175]">Endirimlər</Link>
            <Link href="/new-products" className="rounded-sm text-[.84rem] font-semibold text-[#405451] transition-colors hover:text-[#2F6F68] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#4F8175]">Yenilər</Link>
          </nav>

          <div className="hidden min-w-0 flex-1 md:block">
            <SearchForm categories={categories} />
          </div>

          <div className="hidden shrink-0 md:block">
            <CitySelector cities={cities} />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
            <Link href="/favorites" aria-label="Sevimlilər" className="grid min-h-11 min-w-10 place-items-center rounded-xl text-[#405451] transition-colors hover:bg-[#EFF4F1] hover:text-[#2F6F68] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4F8175] sm:min-w-11">
              <Heart aria-hidden="true" size={19} />
            </Link>
            <Link href="/cart" aria-label="Səbət" className="grid min-h-11 min-w-10 place-items-center rounded-xl text-[#405451] transition-colors hover:bg-[#EFF4F1] hover:text-[#2F6F68] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4F8175] sm:min-w-11">
              <ShoppingBag aria-hidden="true" size={19} />
            </Link>
            <CustomerAccountMenu user={user ? { email: user.email, displayName: user.displayName, role: user.role } : null} />
          </div>
        </div>

        <nav aria-label="Alış-veriş bölmələri" className="hidden border-t border-[#EDF1EE] py-1.5 md:flex md:items-center md:gap-6 xl:hidden">
          <CategoryMegaMenu categories={categories} />
          <Link href="/stores" className="inline-flex min-h-9 items-center rounded-sm text-xs font-semibold text-[#405451] transition-colors hover:text-[#2F6F68] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4F8175]">Mağazalar</Link>
          <Link href="/deals" className="inline-flex min-h-9 items-center rounded-sm text-xs font-semibold text-[#405451] transition-colors hover:text-[#2F6F68] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4F8175]">Endirimlər</Link>
          <Link href="/new-products" className="inline-flex min-h-9 items-center rounded-sm text-xs font-semibold text-[#405451] transition-colors hover:text-[#2F6F68] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4F8175]">Yeni məhsullar</Link>
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
