import type { Prisma } from "@prisma/client";

/**
 * Products of a category page, as a Prisma Category filter: the category with this slug, or (for a top-level slug)
 * any of its subcategories. The product's category must be active, and a subcategory's parent must be active too.
 * Unknown slugs match nothing (as before). Used by /products, the product APIs, /categories and store pages.
 */
export function categoryScopeWhere(slug: string): Prisma.CategoryWhereInput {
  return {
    isActive: true,
    AND: [
      { OR: [{ parentId: null }, { parent: { is: { isActive: true } } }] },
      { OR: [{ slug }, { parent: { is: { slug } } }] },
    ],
  };
}
