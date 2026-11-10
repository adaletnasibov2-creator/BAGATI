import Link from "next/link";
import { categoriesWithOtherLast } from "@/lib/category-order";
import { CategoryIcon } from "@/components/category-icon";
type Category = { id: string; name: string; slug: string };

export function CategoryNavigation({ categories }: { categories: Category[] }) {
  return (
    <nav aria-label="Kateqoriyalar" className="flex gap-3 overflow-x-auto pb-2">
      {categoriesWithOtherLast(categories).map((category) => (
        <Link
          key={category.id}
          href={`/categories?category=${encodeURIComponent(category.slug)}`}
          className="group flex min-w-[92px] flex-col items-center gap-2 rounded-2xl border border-bagati-border bg-white px-2 py-3 text-center text-xs font-medium text-bagati-text transition hover:-translate-y-0.5 hover:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bagati-gold motion-reduce:transition-none"
        >
          <CategoryIcon category={category} size="medium" />
          <span className="line-clamp-2 min-h-8">{category.name}</span>
        </Link>
      ))}
    </nav>
  );
}
