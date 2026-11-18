"use client";

import { PRODUCT_SHELF_TRACK_CLASS } from "@/components/product-layout";
import { HomeSectionHeading } from "@/components/home/section-heading";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef } from "react";

type ProductShelfProps = {
  id: string;
  eyebrow: string;
  title: string;
  href: string;
  actionLabel: string;
  children: React.ReactNode;
};

export function ProductShelf({ id, eyebrow, title, href, actionLabel, children }: ProductShelfProps) {
  const shelfRef = useRef<HTMLDivElement>(null);

  function scroll(direction: -1 | 1) {
    const shelf = shelfRef.current;
    if (!shelf) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    shelf.scrollBy({ left: direction * Math.max(shelf.clientWidth * 0.8, 240), behavior: reduceMotion ? "auto" : "smooth" });
  }

  return (
    <section className="container py-8 sm:py-12" aria-labelledby={`${id}-title`}>
      <HomeSectionHeading id={`${id}-title`} eyebrow={eyebrow} title={title} href={href} actionLabel={actionLabel}>
        <div className="hidden items-center gap-1.5 sm:flex">
          <button type="button" aria-label={`${title}: əvvəlki məhsullar`} onClick={() => scroll(-1)} className="grid h-11 w-11 place-items-center rounded-full border border-line bg-white text-fg-body transition-colors hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none">
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <button type="button" aria-label={`${title}: növbəti məhsullar`} onClick={() => scroll(1)} className="grid h-11 w-11 place-items-center rounded-full border border-line bg-white text-fg-body transition-colors hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none">
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        </div>
      </HomeSectionHeading>
      <div
        ref={shelfRef}
        role="region"
        aria-label={`${title} məhsulları`}
        tabIndex={0}
        className={`${PRODUCT_SHELF_TRACK_CLASS} overflow-x-auto overscroll-x-contain scroll-smooth snap-x snap-mandatory pb-3 outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2`}
      >
        {children}
      </div>
    </section>
  );
}
