import type { Metadata } from "next";
import { categoryHref } from "@/lib/category-tree";

/**
 * Category page metadata: unique title and description per category, canonical to the clean category URL
 * (/products?category=<slug>, without city, search, sort or cursor), and noindex for unknown, inactive or empty
 * categories. The canonical is absolute from APP_BASE_URL; without a valid base it is omitted rather than pointing
 * at localhost (the root layout sets no metadataBase).
 */
export function absoluteSiteUrl(path: string, base: string | undefined = process.env.APP_BASE_URL): string | null {
  if (!base?.trim()) return null;
  try {
    const url = new URL(base.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return new URL(path, url.origin).toString();
  } catch {
    return null;
  }
}

export function categoryPageMetadata(input: {
  category: { name: string; slug: string; isActive: boolean } | null;
  parent: { name: string; isActive: boolean } | null;
  visibleCount: number;
  base?: string;
}): Metadata {
  const { category, parent, visibleCount } = input;
  if (!category) return { title: "Kateqoriya tapılmadı", robots: { index: false, follow: true } };
  const title = parent ? `${category.name} — ${parent.name}` : category.name;
  const description = (parent
    ? `${parent.name} bölməsində ${category.name}: BAGATI mağazalarından ${visibleCount} məhsul. Qiymətləri müqayisə edin və sifariş verin.`
    : `${category.name} kateqoriyası: BAGATI mağazalarından ${visibleCount} məhsul və alt kateqoriyalar. Qiymətləri müqayisə edin və sifariş verin.`).slice(0, 160);
  const indexable = category.isActive && (!parent || parent.isActive) && visibleCount > 0;
  const canonical = absoluteSiteUrl(categoryHref(category.slug), input.base);
  return {
    title,
    description,
    ...(canonical ? { alternates: { canonical } } : {}),
    ...(indexable ? {} : { robots: { index: false, follow: true } }),
    openGraph: { title, description, type: "website", ...(canonical ? { url: canonical } : {}) },
  };
}
