"use client";

import Link from "next/link";
import { useRef, useState, type MouseEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CategoryGlyph, CategoryIcon } from "@/components/category-icon";
import { categoryHref } from "@/lib/category-tree";
import { useDismissibleDetails } from "@/components/use-dismissible-details";

type MenuSubcategory = { id: string; name: string; slug: string; iconKey?: string | null; imageUrl?: string | null; parentIconKey?: string | null; count?: number };
export type MegaMenuCategory = MenuSubcategory & { parentId?: string | null; children?: MenuSubcategory[] };

/**
 * Top-level cards stay as before (photo, or icon when a top-level has no photo). Hovering a card, or pressing its
 * chevron button (keyboard: Tab to it, Enter/Space), shows that category's subcategories with icons below the grid.
 * Only categories with visible products are passed in (lib/public-category-tree.ts).
 */
export function CategoryMegaMenu({ categories }: { categories: MegaMenuCategory[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const active = categories.find((category) => category.id === activeId && category.children?.length);
  const panelId = "mega-menu-subcategories";
  // Closes on route change, on a link click inside, on an outside click and on Escape (focus back to the button).
  const menu = useDismissibleDetails(() => setActiveId(null));

  function toggle(event: MouseEvent<HTMLButtonElement>, id: string) {
    const opening = activeId !== id;
    setActiveId(opening ? id : null);
    // Keyboard activation (detail 0): move focus into the panel so its links come next.
    if (opening && event.detail === 0) window.requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("a")?.focus());
  }

  return (
    <details ref={menu.ref} className="group relative" onToggle={menu.onToggle} onClick={menu.onClick}>
      <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1 rounded-sm text-sm font-semibold text-bagati-text transition-colors hover:text-bagati-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bagati-gold [&::-webkit-details-marker]:hidden">
        Kateqoriyalar
        <ChevronDown aria-hidden="true" size={14} className="transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="absolute left-0 top-full z-50 mt-2 w-[min(760px,calc(100vw-32px))] rounded-2xl border border-bagati-border bg-white p-5 shadow-[0_24px_60px_rgba(23,58,58,.15)] sm:p-6">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-[.65rem] font-semibold uppercase tracking-[.16em] text-bagati-muted">BAGATI kataloqu</p>
            <h2 className="mt-1 text-lg font-semibold text-bagati-deep">Nə axtarırsan?</h2>
          </div>
          <Link href="/categories" className="inline-flex min-h-10 items-center gap-1 text-xs font-semibold text-bagati-accent hover:text-bagati-primary focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-bagati-gold">
            Hamısına bax<ChevronRight aria-hidden="true" size={14} />
          </Link>
        </div>
        {categories.length ? (
          <div className="max-h-[min(64vh,540px)] overflow-y-auto overscroll-contain">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {categories.map((category) => {
                const hasChildren = Boolean(category.children?.length);
                const isActive = activeId === category.id;
                return (
                  <div
                    key={category.id}
                    onMouseEnter={() => { if (hasChildren) setActiveId(category.id); }}
                    className={`relative flex min-h-[72px] items-center rounded-2xl border text-sm font-medium text-bagati-text transition motion-reduce:transition-none ${isActive ? "border-[#C8D6CD] bg-white shadow-[0_8px_20px_rgba(23,58,58,.08)]" : "border-bagati-border/80 bg-bagati-page/70 hover:-translate-y-0.5 hover:border-[#C8D6CD] hover:bg-white hover:shadow-[0_8px_20px_rgba(23,58,58,.08)]"}`}
                  >
                    <Link
                      href={categoryHref(category.slug)}
                      className="group flex min-h-[70px] min-w-0 flex-1 items-center gap-2.5 rounded-2xl p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bagati-gold"
                    >
                      <CategoryIcon category={category} size="small" loading="lazy" />
                      <span className="line-clamp-2 min-w-0">{category.name}</span>
                    </Link>
                    {hasChildren && (
                      <button
                        type="button"
                        aria-expanded={isActive}
                        aria-controls={panelId}
                        aria-label={`${category.name}: alt kateqoriyalar`}
                        onClick={(event) => toggle(event, category.id)}
                        className="mr-1 grid h-10 w-9 shrink-0 place-items-center rounded-xl text-bagati-muted hover:bg-bagati-section hover:text-bagati-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-bagati-gold"
                      >
                        <ChevronDown aria-hidden="true" size={16} className={`transition-transform motion-reduce:transition-none ${isActive ? "rotate-180" : ""}`} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div id={panelId} ref={panelRef} aria-live="polite">
              {active && (
                <section aria-label={`${active.name}: alt kateqoriyalar`} className="mt-3 rounded-2xl border border-bagati-border bg-bagati-page/60 p-3 sm:p-4">
                  <Link href={categoryHref(active.slug)} className="inline-flex min-h-10 items-center gap-1 rounded-sm text-sm font-semibold text-bagati-deep hover:text-bagati-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-bagati-gold">
                    Bütün {active.name}<ChevronRight aria-hidden="true" size={14} />
                  </Link>
                  <ul className="mt-1 grid grid-cols-1 gap-1 min-[420px]:grid-cols-2 sm:grid-cols-3">
                    {active.children!.map((child) => (
                      <li key={child.id} className="min-w-0">
                        <Link href={categoryHref(child.slug)} className="flex min-h-10 min-w-0 items-center gap-2 rounded-xl px-2 text-[.82rem] text-bagati-text hover:bg-white hover:text-bagati-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-bagati-gold">
                          <CategoryGlyph category={child} size={17} className="text-[#1f5a4f]" />
                          <span className="min-w-0 truncate">{child.name}</span>
                          {child.count ? <span className="ml-auto shrink-0 text-xs text-bagati-muted">{child.count}</span> : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        ) : (
          <p className="px-1 py-3 text-sm text-bagati-muted">Kateqoriyalar hələ əlavə edilməyib.</p>
        )}
      </div>
    </details>
  );
}
