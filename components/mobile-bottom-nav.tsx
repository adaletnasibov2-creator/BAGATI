"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Grid2X2, Home, Search, ShoppingBag, UserRound } from "lucide-react";

type BottomNavUser = { role: "CUSTOMER" | "VENDOR" | "ADMIN" } | null;
const entries = [
  { href: "/", label: "Ana səhifə", Icon: Home, matches: (path: string) => path === "/" },
  { href: "/categories", label: "Kateqoriyalar", Icon: Grid2X2, matches: (path: string) => path.startsWith("/categories") },
  { href: "/products", label: "Axtarış", Icon: Search, matches: (path: string) => path.startsWith("/products") },
  { href: "/cart", label: "Səbət", Icon: ShoppingBag, matches: (path: string) => path.startsWith("/cart") },
];

export function MobileBottomNav({ user }: { user: BottomNavUser }) {
  const pathname = usePathname();
  const accountHref = user?.role === "VENDOR" ? "/vendor" : user?.role === "ADMIN" ? "/admin" : user ? "/account" : "/login";
  const accountActive = ["/account", "/login", "/register", "/vendor", "/admin"].some((path) => pathname.startsWith(path));

  return (
    <nav aria-label="Mobil əsas naviqasiya" className="fixed inset-x-0 bottom-0 z-40 border-t border-bagati-border bg-white/95 shadow-[0_-8px_24px_rgba(23,58,58,.08)] backdrop-blur-xl md:hidden">
      <ul className="mx-auto grid min-h-[62px] max-w-lg grid-cols-5 px-1 pb-[env(safe-area-inset-bottom)]">
        {entries.map(({ href, label, Icon, matches }) => {
          const active = matches(pathname);
          return (
            <li key={href}>
              <Link href={href} aria-label={label} aria-current={active ? "page" : undefined} className={`flex min-h-[60px] flex-col items-center justify-center gap-1 rounded-lg px-1 text-[.62rem] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-bagati-gold ${active ? "text-bagati-primary" : "text-bagati-muted hover:text-bagati-primary"}`}>
                <Icon aria-hidden="true" size={19} strokeWidth={active ? 2.2 : 1.8} />
                <span className="leading-none">{label}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <Link href={accountHref} aria-label="Hesab" aria-current={accountActive ? "page" : undefined} className={`flex min-h-[60px] flex-col items-center justify-center gap-1 rounded-lg px-1 text-[.62rem] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-bagati-gold ${accountActive ? "text-bagati-primary" : "text-bagati-muted hover:text-bagati-primary"}`}>
            <UserRound aria-hidden="true" size={19} strokeWidth={accountActive ? 2.2 : 1.8} />
            <span className="leading-none">Hesab</span>
          </Link>
        </li>
      </ul>
    </nav>
  );
}
