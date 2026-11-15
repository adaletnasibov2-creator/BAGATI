import Link from "next/link";
import { PackageOpen } from "lucide-react";
import { categoryHref } from "@/lib/category-tree";

/**
 * Friendly state for a category page without products (or a category that is not available). Same layout as the
 * page around it; links to all products and to related categories so the visitor is never stuck.
 */
export function CategoryEmptyState({
  title = "Bu kateqoriyada hələ məhsul yoxdur. Tezliklə əlavə olunacaq.",
  detail = "Hələlik bütün məhsullara və ya yaxın kateqoriyalara baxa bilərsiniz.",
  links,
  hrefFor = categoryHref,
}: {
  title?: string;
  detail?: string;
  links: { name: string; slug: string }[];
  hrefFor?: (slug: string) => string;
}) {
  return (
    <section aria-labelledby="category-empty-title" className="rounded-2xl border border-dashed border-[#d8d4ca] bg-white px-5 py-10 text-center sm:px-8">
      <PackageOpen aria-hidden="true" size={32} strokeWidth={1.5} className="mx-auto text-emerald" />
      <h2 id="category-empty-title" className="mx-auto mt-3 max-w-xl text-base font-semibold text-ink sm:text-lg">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted">{detail}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Link href="/products" className="inline-flex min-h-11 items-center rounded-xl bg-ink px-4 text-sm font-medium text-white hover:bg-emerald focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald">Bütün məhsullar</Link>
        {links.map((link) => (
          <Link key={link.slug} href={hrefFor(link.slug)} className="inline-flex min-h-11 max-w-full items-center rounded-xl border border-line bg-white px-4 text-sm text-ink hover:border-emerald hover:text-emerald focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald">
            <span className="truncate">{link.name}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
