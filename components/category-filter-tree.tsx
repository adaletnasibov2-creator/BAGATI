"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { CategoryGlyph, CategoryIcon } from "@/components/category-icon";
import { categoryFilterHref, type CategoryFilterLink } from "@/lib/category-filter-href";
import type { PublicCategoryNode } from "@/lib/public-category-tree";

/**
 * Product list category filter: expand/collapse per top-level (native <details>, works without JavaScript),
 * counts of visible products (zero counts are not shown), plain links so every filter state is a shareable URL.
 *
 * A client component since SCALE-FIX-3 (B2): the server sends only the category data (on /products the very same
 * tree object the header already sends, so React references it instead of repeating it) instead of the rendered
 * markup with an SVG icon per row (124 KB of page payload on /products before). The HTML is the same.
 */
export function CategoryFilterTree({
  tree,
  selectedSlug,
  link: filterLink,
}: {
  tree: PublicCategoryNode[];
  selectedSlug: string | null;
  link: CategoryFilterLink;
}) {
  const href = (slug: string | null) => categoryFilterHref(filterLink, slug);
  const link = "flex min-h-10 min-w-0 items-center gap-2 rounded-lg px-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald";
  const current = (slug: string | null) => (selectedSlug ?? null) === slug;
  return (
    <nav aria-label="Kateqoriya filtri" className="rounded-2xl border border-line bg-white p-3">
      <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-[.14em] text-muted">Kateqoriyalar</p>
      <ul className="grid gap-0.5">
        <li>
          <Link href={href(null)} aria-current={current(null) ? "page" : undefined} className={`${link} ${current(null) ? "bg-[#f0f4f0] font-semibold text-ink" : "text-muted hover:bg-paper hover:text-ink"}`}>
            Bütün kateqoriyalar
          </Link>
        </li>
        {tree.map((top) => {
          const open = current(top.slug) || top.children.some((child) => current(child.slug));
          return (
            <li key={top.id} className="relative">
              <Link href={href(top.slug)} aria-current={current(top.slug) ? "page" : undefined} className={`${link} ${top.children.length ? "mr-10" : ""} ${current(top.slug) ? "bg-[#f0f4f0] font-semibold text-ink" : "text-ink hover:bg-paper"}`}>
                <CategoryIcon category={top} size="small" className="!h-7 !w-7 !rounded-lg" />
                <span className="min-w-0 truncate">{top.name}</span>
                {top.count ? <span className="ml-auto shrink-0 text-xs text-muted">{top.count}</span> : null}
              </Link>
              {top.children.length > 0 && (
                // The chevron is the <summary> itself (beside the link, not wrapping it), so no interactive element is nested.
                <details open={open} className="group">
                  <summary aria-label={`${top.name}: alt kateqoriyalar`} className="absolute right-0 top-0 grid h-10 w-9 cursor-pointer list-none place-items-center rounded-lg text-muted hover:bg-paper group-open:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald [&::-webkit-details-marker]:hidden">
                    <ChevronDown aria-hidden="true" size={16} className="transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                  </summary>
                  <ul className="mb-1 ml-4 grid gap-0.5 border-l border-line pl-2">
                    {top.children.map((child) => (
                      <li key={child.id}>
                        <Link href={href(child.slug)} aria-current={current(child.slug) ? "page" : undefined} className={`${link} ${current(child.slug) ? "bg-[#f0f4f0] font-semibold text-ink" : "text-muted hover:bg-paper hover:text-ink"}`}>
                          <CategoryGlyph category={child} size={16} className="text-emerald" />
                          <span className="min-w-0 truncate">{child.name}</span>
                          {child.count ? <span className="ml-auto shrink-0 text-xs">{child.count}</span> : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
