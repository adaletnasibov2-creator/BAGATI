"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CART_CHANGED_EVENT, headerBadgeText } from "@/lib/cart-events";
import { cx } from "@/components/ui/cx";
import { BagIcon, HeartIcon } from "@/components/header-icons";

/**
 * Header action items (DESIGN-POLISH-2, the owner's variant 2): ONE link per item, a two-colour icon in a light-green
 * circle above a one-line label. From 768 px: 48 px circle (#e1ece8, hover #c4d9d1, pressed a little darker), 13 px
 * label (weight 500, #173a3a = 12.33:1 on white, primary on hover), 4 px gap. Below 768 px: 44 px circle only; the label
 * stays in the DOM as sr-only, so the accessible name is still the visible label (no aria-label, WCAG 2.5.3).
 * The count badges (DESIGN-POLISH-1) show REAL numbers only and are aria-hidden: favourites from this browser's saved
 * list, the cart from the signed-in customer's cart lines (null for guests and other roles = no badge). Hidden at 0.
 */
export const headerActionItem = cx(
  "group/action relative inline-flex min-h-11 min-w-11 shrink-0 flex-col items-center justify-center gap-1 rounded-control text-fg md:px-1",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
);
/** Size, shape and pressed motion of the circle; the colours are added by headerActionCircle (or by the account avatar). */
export const headerActionCircleBase = cx(
  "relative grid h-11 w-11 shrink-0 place-items-center rounded-full md:h-12 md:w-12",
  "transition-[background-color,transform,filter] duration-150 ease-out motion-reduce:transition-none",
  "group-active/action:brightness-95 motion-safe:group-active/action:scale-95",
);
export const headerActionCircle = cx(
  headerActionCircleBase,
  "bg-brand-100 group-hover/action:bg-brand-200 group-active/action:bg-brand-200 group-aria-[current=page]/action:bg-brand-200",
);
export const headerActionLabel = cx(
  "sr-only md:not-sr-only md:whitespace-nowrap md:text-[13px] md:font-medium md:leading-4 md:text-fg",
  "md:transition-colors md:duration-150 motion-reduce:transition-none md:group-hover/action:text-primary md:group-aria-[current=page]/action:text-primary",
);

function CountBadge({ count }: { count: number | null }) {
  const text = headerBadgeText(count);
  if (!text) return null;
  // White on #174746 is 10.36:1; the 2 px white border separates the badge from the circle.
  return <span aria-hidden="true" data-header-count="" className="pointer-events-none absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full border-2 border-white bg-primary px-1 text-[12px] font-medium leading-none tabular-nums text-white">{text}</span>;
}

const FAVORITES_KEY = "bagati_favorites";
function readFavoriteCount(): number {
  try { const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"); return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string").length : 0; } catch { return 0; }
}

function ActionLink({ href, label, icon, badge }: { href: string; label: string; icon: ReactNode; badge: number | null }) {
  const pathname = usePathname();
  return <Link href={href} data-header-action="" aria-current={pathname === href ? "page" : undefined} className={headerActionItem}>
    <span data-header-circle="" className={headerActionCircle}>{icon}<CountBadge count={badge} /></span>
    <span data-header-label="" className={headerActionLabel}>{label}</span>
  </Link>;
}

export function HeaderFavoritesLink() {
  // null until mounted: the server HTML has no badge and an unfilled heart, so hydration always matches.
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const sync = () => setCount(readFavoriteCount());
    sync();
    const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === FAVORITES_KEY) sync(); };
    window.addEventListener("bagati:favorites", sync);
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener("bagati:favorites", sync); window.removeEventListener("storage", onStorage); };
  }, []);
  // Filled heart only while the saved list is not empty (real data).
  return <ActionLink href="/favorites" label="Sevimlilərim" badge={count} icon={<HeartIcon size={30} filled={(count ?? 0) > 0} />} />;
}

export function HeaderCartLink({ initialCount }: { initialCount: number | null }) {
  const [count, setCount] = useState(initialCount);
  // A server render with a new count (navigation, router.refresh after an order) wins.
  useEffect(() => { setCount(initialCount); }, [initialCount]);
  useEffect(() => {
    if (initialCount === null) return; // guests and other roles: no server cart, no badge
    let active = true;
    async function reload() {
      try {
        const response = await fetch("/api/cart", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (active) setCount(Array.isArray(data?.cart?.items) ? data.cart.items.length : 0);
      } catch { /* keep the last real number */ }
    }
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ count?: number }>).detail;
      if (typeof detail?.count === "number") setCount(detail.count); else void reload();
    };
    window.addEventListener(CART_CHANGED_EVENT, onChange);
    return () => { active = false; window.removeEventListener(CART_CHANGED_EVENT, onChange); };
  }, [initialCount]);
  return <ActionLink href="/cart" label="Səbətim" badge={count} icon={<BagIcon size={30} />} />;
}

/**
 * Section link in the header's second row: pill hover, a 2 px underline on hover and on the current section
 * (aria-current="page"), the green focus ring. Text unchanged.
 */
export function HeaderNavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const current = pathname === href || pathname.startsWith(`${href}/`);
  return <Link href={href} aria-current={current ? "page" : undefined} className={headerNavLinkClass}>{children}</Link>;
}

export const headerNavLinkClass = cx(
  "relative inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-fg",
  "transition-colors duration-150 motion-reduce:transition-none hover:bg-primary-subtle hover:text-primary active:bg-primary-tint",
  "after:pointer-events-none after:absolute after:inset-x-3 after:bottom-1 after:h-0.5 after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity after:duration-150 motion-reduce:after:transition-none",
  "hover:after:opacity-40 aria-[current=page]:text-primary aria-[current=page]:after:opacity-100",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
);
