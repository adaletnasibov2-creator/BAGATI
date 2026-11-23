"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Grid2X2, Home, Search, ShoppingBag, UserRound } from "lucide-react";
import { BagIcon } from "@/components/header-icons";

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
    <nav aria-label="Mobil əsas naviqasiya" data-mobile-bottom-nav="" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 shadow-[0_-8px_24px_rgba(23,58,58,.08)] backdrop-blur-xl md:hidden">
      <ul className="mx-auto grid min-h-[62px] max-w-lg grid-cols-5 px-1 pb-[env(safe-area-inset-bottom)]">
        {entries.map(({ href, label, Icon, matches }) => {
          const active = matches(pathname);
          return (
            <li key={href}>
              <Link href={href} aria-label={label} aria-current={active ? "page" : undefined} className={`group/tab flex min-h-[60px] flex-col items-center justify-center gap-0.5 rounded-control px-1 text-[0.75rem] font-medium transition-colors active:bg-primary-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-focus ${active ? "font-semibold text-primary" : "text-fg-body hover:text-primary"}`}>
                <span aria-hidden="true" className={`grid h-8 w-14 place-items-center rounded-full transition-colors ${active ? "bg-primary-tint" : ""}`}>{href === "/cart" ? <BagIcon size={24} /> : <Icon size={22} strokeWidth={active ? 2.25 : 2} />}</span>
                <span className="leading-none">{label}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <Link href={accountHref} aria-label="Hesab" aria-current={accountActive ? "page" : undefined} className={`group/tab flex min-h-[60px] flex-col items-center justify-center gap-0.5 rounded-control px-1 text-[0.75rem] font-medium transition-colors active:bg-primary-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-focus ${accountActive ? "font-semibold text-primary" : "text-fg-body hover:text-primary"}`}>
            <span aria-hidden="true" className={`grid h-8 w-14 place-items-center rounded-full transition-colors ${accountActive ? "bg-primary-tint" : ""}`}><UserRound size={22} strokeWidth={accountActive ? 2.25 : 2} /></span>
            <span className="leading-none">Hesab</span>
          </Link>
        </li>
      </ul>
    </nav>
  );
}
