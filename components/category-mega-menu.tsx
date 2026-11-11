import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CategoryIcon } from "@/components/category-icon";

type CategoryOption = { id: string; name: string; slug: string };

export function CategoryMegaMenu({ categories }: { categories: CategoryOption[] }) {
  return (
    <details className="group relative">
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
          <div className="grid max-h-[min(52vh,420px)] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={`/products?category=${encodeURIComponent(category.slug)}`}
                className="group flex min-h-[72px] items-center gap-2.5 rounded-2xl border border-bagati-border/80 bg-bagati-page/70 p-2 text-sm font-medium text-bagati-text transition hover:-translate-y-0.5 hover:border-[#C8D6CD] hover:bg-white hover:shadow-[0_8px_20px_rgba(23,58,58,.08)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-bagati-gold motion-reduce:transition-none"
              >
                <CategoryIcon category={category} size="small" />
                <span className="line-clamp-2 min-w-0">{category.name}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="px-1 py-3 text-sm text-bagati-muted">Kateqoriyalar hələ əlavə edilməyib.</p>
        )}
      </div>
    </details>
  );
}
