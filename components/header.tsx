import Link from "next/link";
import { Heart, ShoppingBag } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { CitySelector } from "@/components/city-selector";
import { CustomerAccountMenu } from "@/components/customer-account-menu";
import { MobileMenu } from "@/components/mobile-menu";
import { SearchForm } from "@/components/search-form";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function Header({ branding }: { branding: { siteName: string; logoUrl: string | null } }) {
  const [user, cities] = await Promise.all([
    currentUser(),
    prisma.city.findMany({
      where: { isActive: true },
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <header className="relative z-40 border-b border-[#E3E9E5] bg-white/95 shadow-[0_8px_24px_rgba(23,58,58,.045)] backdrop-blur-xl">
      <div className="bg-[#173A3A] text-[#F6F7F4]">
        <div className="container flex min-h-9 items-center justify-between gap-2 text-[.65rem] sm:text-[.72rem]">
          <p className="min-w-0 truncate">Azərbaycanda sevdiyin mağazalar və məhsullar bir məkanda.</p>
          <nav aria-label="Xidmət keçidləri" className="flex shrink-0 items-center gap-3 sm:gap-4">
            <Link href="/delivery-returns" className="hidden hover:text-[#E8D7B7] sm:inline">Çatdırılma</Link>
            <Link href="/help" className="hidden hover:text-[#E8D7B7] sm:inline">Kömək</Link>
            <Link href="/vendor/login" className="font-semibold hover:text-[#E8D7B7]">Satıcı girişi</Link>
          </nav>
        </div>
      </div>
      <div className="container">
        <div className="flex min-h-[78px] items-center gap-2 sm:gap-3 md:min-h-[88px] md:gap-5">
          <div className="md:hidden">
            <MobileMenu cities={cities} user={user ? { email: user.email, displayName: user.displayName, role: user.role } : null} />
          </div>

          <span className="sm:hidden"><BrandLogo variant="icon" className="py-1" priority {...branding} /></span>
          <span className="hidden sm:inline-flex"><BrandLogo variant="full" className="py-1" priority {...branding} /></span>

          <nav aria-label="Əsas naviqasiya" className="hidden shrink-0 items-center gap-4 xl:flex">
            <Link href="/categories" className="text-[.84rem] font-semibold text-[#405451] transition hover:text-[#2F6F68]">Kateqoriyalar</Link>
            <Link href="/stores" className="text-[.84rem] font-semibold text-[#405451] transition hover:text-[#2F6F68]">Mağazalar</Link>
            <Link href="/deals" className="text-[.84rem] font-semibold text-[#405451] transition hover:text-[#2F6F68]">Endirimlər</Link>
            <Link href="/new-products" className="text-[.84rem] font-semibold text-[#405451] transition hover:text-[#2F6F68]">Yenilər</Link>
          </nav>

          <div className="hidden min-w-0 flex-1 md:block">
            <SearchForm />
          </div>

          <div className="hidden shrink-0 md:block">
            <CitySelector cities={cities} />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
            <Link href="/favorites" aria-label="Sevimlilər" className="grid min-h-11 min-w-10 place-items-center rounded-xl text-[#405451] transition hover:bg-[#EFF4F1] hover:text-[#2F6F68] sm:min-w-11">
              <Heart aria-hidden="true" size={19} />
            </Link>
            <Link href="/cart" aria-label="Səbət" className="grid min-h-11 min-w-10 place-items-center rounded-xl text-[#405451] transition hover:bg-[#EFF4F1] hover:text-[#2F6F68] sm:min-w-11">
              <ShoppingBag aria-hidden="true" size={19} />
            </Link>
            <CustomerAccountMenu user={user ? { email: user.email, displayName: user.displayName, role: user.role } : null} />
          </div>
        </div>

        <nav aria-label="Alış-veriş bölmələri" className="hidden border-t border-[#EDF1EE] py-1.5 md:flex md:items-center md:gap-6 xl:hidden">
          <Link href="/categories" className="inline-flex min-h-9 items-center text-xs font-semibold text-[#405451] transition hover:text-[#2F6F68]">Kateqoriyalar</Link>
          <Link href="/stores" className="inline-flex min-h-9 items-center text-xs font-semibold text-[#405451] transition hover:text-[#2F6F68]">Mağazalar</Link>
          <Link href="/deals" className="inline-flex min-h-9 items-center text-xs font-semibold text-[#405451] transition hover:text-[#2F6F68]">Endirimlər</Link>
          <Link href="/new-products" className="inline-flex min-h-9 items-center text-xs font-semibold text-[#405451] transition hover:text-[#2F6F68]">Yeni məhsullar</Link>
        </nav>

        <div className="flex items-center gap-2.5 pb-3 md:hidden">
          <SearchForm mobile />
          <div className="shrink-0">
            <CitySelector cities={cities} />
          </div>
        </div>
      </div>
    </header>
  );
}
