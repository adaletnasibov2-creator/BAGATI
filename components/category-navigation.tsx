import Link from "next/link";
import { categoriesWithOtherLast } from "@/lib/category-order";
type Category = { id: string; name: string; slug: string };
export function CategoryNavigation({ categories }: { categories: Category[] }) { return <nav aria-label="Kateqoriyalar" className="flex gap-5 overflow-x-auto whitespace-nowrap">{categoriesWithOtherLast(categories).map(category => <Link key={category.id} href={`/categories?category=${encodeURIComponent(category.slug)}`} className="text-sm text-slate-600 hover:text-emerald">{category.name}</Link>)}</nav>; }
