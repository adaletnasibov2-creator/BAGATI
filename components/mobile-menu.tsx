"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Heart, Menu, ShoppingBag, UserRound, X } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { CategoryGlyph, CategoryIcon } from "@/components/category-icon";
import { categoryHref } from "@/lib/category-tree";
import { CitySelector } from "@/components/city-selector";
import { finishAuthNavigation, postLogout } from "@/lib/auth-client";

const links = [["/stores", "Mağazalar"], ["/deals", "Endirimlər"], ["/new-products", "Yeni məhsullar"], ["/vendor/apply", "Satıcı ol"]] as const;
type MenuIdentity = { email: string; displayName: string; role: "CUSTOMER" | "VENDOR" | "ADMIN" };
type MenuSubcategory = { id: string; name: string; slug: string; iconKey?: string | null; imageUrl?: string | null; parentIconKey?: string | null; count?: number };
type MenuCategory = MenuSubcategory & { parentId?: string | null; children?: MenuSubcategory[] };

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
              {/* Accordion: a top-level row links to its page; the chevron shows its subcategories. */}
              <ul className="mt-2 grid gap-1.5">
                {categories.map((category) => {
                  const children = category.children ?? [];
                  const expanded = expandedId === category.id;
                  const panelId = `mobile-subcategories-${category.id}`;
                  return (
                    <li key={category.id} className="rounded-2xl border border-bagati-border/80 bg-bagati-page/70">
                      <div className="flex min-w-0 items-center">
                        <Link onClick={closeMenu} href={categoryHref(category.slug)} className="group flex min-h-[60px] min-w-0 flex-1 items-center gap-2 rounded-2xl p-2 text-[.82rem] font-medium text-bagati-text transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-bagati-gold motion-reduce:transition-none">
                          <CategoryIcon category={category} size="small" loading="lazy" />
                          <span className="line-clamp-2 min-w-0">{category.name}</span>
                        </Link>
                        {children.length > 0 && (
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-controls={panelId}
                            aria-label={`${category.name}: alt kateqoriyalar`}
                            onClick={() => setExpandedId(expanded ? null : category.id)}
                            className="mr-1 grid h-11 w-11 shrink-0 place-items-center rounded-xl text-bagati-muted hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-bagati-gold"
                          >
                            <ChevronDown aria-hidden="true" size={18} className={`transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />
                          </button>
                        )}
                      </div>
                      {children.length > 0 && expanded && (
                        <ul id={panelId} className="grid gap-0.5 border-t border-bagati-border/70 px-2 pb-2 pt-1">
                          <li><Link onClick={closeMenu} href={categoryHref(category.slug)} className="flex min-h-11 items-center rounded-lg px-2 text-[.8rem] font-semibold text-bagati-deep hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-bagati-gold">Bütün {category.name}</Link></li>
                          {children.map((child) => (
                            <li key={child.id} className="min-w-0">
                              <Link onClick={closeMenu} href={categoryHref(child.slug)} className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2 text-[.8rem] text-bagati-text hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-bagati-gold">
                                <CategoryGlyph category={child} size={17} className="text-[#1f5a4f]" />
                                <span className="min-w-0 truncate">{child.name}</span>
                                {child.count ? <span className="ml-auto shrink-0 text-xs text-bagati-muted">{child.count}</span> : null}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
                {!categories.length && <li><Link onClick={closeMenu} href="/categories" className="flex min-h-11 items-center text-sm text-bagati-text">Bütün kateqoriyalara bax</Link></li>}
              </ul>
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
