"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Heart, ShoppingBag } from "lucide-react";
import { CART_CHANGED_EVENT, headerBadgeText } from "@/lib/cart-events";
import { cx } from "@/components/ui/cx";

/**
 * Header icon buttons (DESIGN-POLISH-1): 24 px lucide icons, stroke 2, in the deep icon colour; a 44 x 44 px round target
 * with a hover background, a pressed state and the green focus ring. The count badges show REAL numbers only:
 * favourites from this browser's saved list (the same list the heart buttons write), the cart from the server count
 * of the signed-in customer's cart lines (null for guests and other roles = no badge). Hidden when 0.
 * The number is aria-hidden: the links keep their existing labels "Sevimlilər" and "Səbət" (no new text).
 */
export const headerIconButton = cx(
  "relative grid h-11 w-11 place-items-center rounded-full text-icon",
  "transition-[background-color,color,transform] duration-150 ease-out motion-reduce:transition-none",
  "hover:bg-primary-subtle hover:text-primary active:bg-primary-tint motion-safe:active:scale-95",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
  "aria-[current=page]:bg-primary-subtle aria-[current=page]:text-primary",
);

function CountBadge({ count }: { count: number | null }) {
  const text = headerBadgeText(count);
  if (!text) return null;
  // White on #174746 is 10.36:1; the white ring separates the badge from the icon and the hover background.
  return <span aria-hidden="true" data-header-count="" className="pointer-events-none absolute right-0.5 top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[11px] font-bold leading-none tabular-nums text-white ring-2 ring-white">{text}</span>;
}

const FAVORITES_KEY = "bagati_favorites";
function readFavoriteCount(): number {
  try { const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"); return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string").length : 0; } catch { return 0; }
}

function IconLink({ href, label, children, badge }: { href: string; label: string; children: ReactNode; badge: number | null }) {
  const pathname = usePathname();
  return <Link href={href} aria-label={label} aria-current={pathname === href ? "page" : undefined} className={headerIconButton}>
    {children}
    <CountBadge count={badge} />
  </Link>;
}

export function HeaderFavoritesLink() {
  // null until mounted: the server HTML has no badge, so hydration always matches.
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const sync = () => setCount(readFavoriteCount());
    sync();
    const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === FAVORITES_KEY) sync(); };
    window.addEventListener("bagati:favorites", sync);
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener("bagati:favorites", sync); window.removeEventListener("storage", onStorage); };
  }, []);
  return <IconLink href="/favorites" label="Sevimlilər" badge={count}><Heart aria-hidden="true" size={24} strokeWidth={2} /></IconLink>;
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
  return <IconLink href="/cart" label="Səbət" badge={count}><ShoppingBag aria-hidden="true" size={24} strokeWidth={2} /></IconLink>;
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
