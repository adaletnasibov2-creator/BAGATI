"use client";

import Link from "next/link";
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
    <section className="container py-7 sm:py-9" aria-labelledby={`${id}-title`}>
      <div className="mb-4 flex items-end justify-between gap-3 sm:mb-5">
        <div className="min-w-0">
          <p className="text-[.63rem] font-semibold uppercase tracking-[.16em] text-bagati-muted sm:text-[.68rem]">{eyebrow}</p>
          <h2 id={`${id}-title`} className="mt-1 text-xl font-semibold tracking-tight text-bagati-text sm:text-2xl">{title}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href={href} className="inline-flex min-h-10 items-center gap-1 text-[.68rem] font-semibold text-bagati-text transition hover:text-bagati-accent focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bagati-gold sm:text-sm">
            {actionLabel}<ChevronRight aria-hidden="true" size={15} />
          </Link>
          <div className="hidden items-center gap-1 sm:flex">
            <button type="button" aria-label={`${title}: əvvəlki məhsullar`} onClick={() => scroll(-1)} className="grid h-10 w-10 place-items-center rounded-full border border-bagati-border bg-white text-bagati-text transition hover:border-bagati-accent hover:text-bagati-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-bagati-gold">
              <ChevronLeft aria-hidden="true" size={17} />
            </button>
            <button type="button" aria-label={`${title}: növbəti məhsullar`} onClick={() => scroll(1)} className="grid h-10 w-10 place-items-center rounded-full border border-bagati-border bg-white text-bagati-text transition hover:border-bagati-accent hover:text-bagati-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-bagati-gold">
              <ChevronRight aria-hidden="true" size={17} />
            </button>
          </div>
        </div>
      </div>
      <div
        ref={shelfRef}
        role="region"
        aria-label={`${title} məhsulları`}
        tabIndex={0}
        className="grid auto-cols-[minmax(0,60%)] grid-flow-col gap-3 overflow-x-auto overscroll-x-contain scroll-smooth snap-x snap-mandatory pb-3 outline-none focus-visible:ring-2 focus-visible:ring-bagati-gold focus-visible:ring-offset-2 sm:auto-cols-[minmax(0,36%)] sm:gap-4 xl:auto-cols-[minmax(0,24%)]"
      >
        {children}
      </div>
    </section>
  );
}
