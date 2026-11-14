"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Heart, Menu, ShoppingBag, UserRound, X } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { CategoryIcon } from "@/components/category-icon";
import { CitySelector } from "@/components/city-selector";
import { finishAuthNavigation, postLogout } from "@/lib/auth-client";

const links = [["/stores", "Mağazalar"], ["/deals", "Endirimlər"], ["/new-products", "Yeni məhsullar"], ["/vendor/apply", "Satıcı ol"]] as const;
type MenuIdentity = { email: string; displayName: string; role: "CUSTOMER" | "VENDOR" | "ADMIN" };
type MenuCategory = { id: string; name: string; slug: string };

export function MobileMenu({
  cities,
  categories,
  user,
}: {
  cities: { id: string; name: string; slug: string }[];
  categories: MenuCategory[];
  user: MenuIdentity | null;
}) {
  const [open, setOpen] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const submitting = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const panel = panelRef.current;
    const focusable = () => panel?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    window.requestAnimationFrame(() => focusable()?.[0]?.focus());

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items?.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeMenu, open]);

  async function logout() {
    if (submitting.current) return;
    submitting.current = true;
    setLoggingOut(true);
    setLogoutError("");
    const result = await postLogout();
    if (!result.ok) {
      setLogoutError(result.error);
      submitting.current = false;
      setLoggingOut(false);
      return;
    }
    finishAuthNavigation("/");
  }

  return (
    <div className="md:hidden">
      <button
        ref={triggerRef}
        type="button"
        aria-label={open ? "Menyunu bağla" : "Menyunu aç"}
        aria-expanded={open}
        aria-controls="mobile-market-nav"
        onClick={() => setOpen((value) => !value)}
        className="grid h-11 w-10 place-items-center rounded-xl text-bagati-deep transition hover:bg-bagati-section focus-visible:outline focus-visible:outline-2 focus-visible:outline-bagati-gold"
      >
        {open ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
      </button>
      {/* Portal to <body>: the sticky header has backdrop-filter, which makes it the containing block of any
          position:fixed descendant, so an overlay rendered inside it was only as tall as the header. */}
      {open && typeof document !== "undefined" && createPortal(
        <div data-mobile-menu-overlay className="fixed inset-x-0 top-0 z-[90] h-[100dvh] bg-[rgba(23,58,58,.42)] md:hidden" onClick={(event) => {
          if (event.target === event.currentTarget) closeMenu();
        }}>
          <div
            ref={panelRef}
            id="mobile-market-nav"
            role="dialog"
            aria-modal="true"
            aria-label="Kateqoriyalar və naviqasiya"
            className="h-[100dvh] w-[min(88vw,390px)] overflow-y-auto overscroll-contain bg-white px-5 pb-[calc(20px+env(safe-area-inset-bottom))] pt-3 shadow-[0_24px_70px_rgba(23,58,58,.24)]"
          >
            <div className="flex items-center justify-between border-b border-bagati-border pb-3">
              <BrandLogo variant="compact" />
              <button type="button" aria-label="Menyunu bağla" onClick={closeMenu} className="grid h-11 w-11 place-items-center rounded-full text-bagati-text hover:bg-bagati-section focus-visible:outline focus-visible:outline-2 focus-visible:outline-bagati-gold">
                <X aria-hidden="true" size={19} />
              </button>
            </div>

            <section aria-labelledby="mobile-categories-title" className="border-b border-bagati-border py-4">
              <h2 id="mobile-categories-title" className="text-sm font-semibold text-bagati-deep">Kateqoriyalar</h2>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {categories.map((category) => (
                  <Link key={category.id} onClick={closeMenu} href={`/products?category=${encodeURIComponent(category.slug)}`} className="group flex min-h-[72px] items-center gap-2 rounded-2xl border border-bagati-border/80 bg-bagati-page/70 p-2 text-[.78rem] font-medium text-bagati-text transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-bagati-gold motion-reduce:transition-none">
                    <CategoryIcon category={category} size="small" />
                    <span className="line-clamp-2 min-w-0">{category.name}</span>
                  </Link>
                ))}
                {!categories.length && <Link onClick={closeMenu} href="/categories" className="col-span-2 flex min-h-11 items-center text-sm text-bagati-text">Bütün kateqoriyalara bax</Link>}
              </div>
            </section>

            <nav aria-label="Mağaza bölmələri" className="grid border-b border-bagati-border py-2">
              {links.map(([href, label]) => <Link key={href} onClick={closeMenu} href={href} className="flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-bagati-text hover:bg-bagati-section focus-visible:outline focus-visible:outline-2 focus-visible:outline-bagati-gold">{label}</Link>)}
            </nav>

            <div className="mt-3 flex flex-wrap gap-2">
              {user ? (
                <Link onClick={closeMenu} href={user.role === "VENDOR" ? "/vendor" : user.role === "ADMIN" ? "/admin" : "/account"} className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl bg-bagati-section px-3 text-sm text-bagati-deep">
                  <UserRound aria-hidden="true" size={17} /><span className="max-w-40 truncate">{user.displayName}</span>
                </Link>
              ) : (
                <>
                  <Link onClick={closeMenu} href="/login" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-bagati-section px-3 text-sm text-bagati-deep"><UserRound aria-hidden="true" size={17} />Daxil ol</Link>
                  <Link onClick={closeMenu} href="/register" className="inline-flex min-h-11 items-center rounded-xl border border-bagati-border px-3 text-sm text-bagati-deep">Qeydiyyat</Link>
                  <Link onClick={closeMenu} href="/vendor/login" className="inline-flex min-h-11 items-center rounded-xl border border-bagati-border px-3 text-sm text-bagati-deep">Satıcı girişi</Link>
                </>
              )}
              {user?.role === "CUSTOMER" && <Link onClick={closeMenu} href="/favorites" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-bagati-section px-3 text-sm text-bagati-deep"><Heart aria-hidden="true" size={17} />Sevimlilər</Link>}
              <Link onClick={closeMenu} href="/cart" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-bagati-primary px-3 text-sm text-white"><ShoppingBag aria-hidden="true" size={17} />Səbət</Link>
            </div>

            {user && (
              <div className="mt-3 border-t border-bagati-border pt-3">
                <p className="truncate px-1 text-xs text-bagati-muted">{user.email}</p>
                <button type="button" disabled={loggingOut} onClick={() => void logout()} className="mt-2 min-h-11 rounded-xl px-3 text-sm font-medium text-bagati-text disabled:opacity-60">
                  {loggingOut ? "Çıxış edilir…" : "Hesabdan çıx"}
                </button>
                {logoutError && <p role="alert" className="px-1 text-xs text-red-700">{logoutError}</p>}
              </div>
            )}
            {cities.length > 0 && <div className="mt-4 border-t border-bagati-border pt-4"><CitySelector cities={cities} /></div>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
