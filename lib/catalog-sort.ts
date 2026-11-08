export type ProductCatalogSort = "newest" | "name";

export function normalizeProductCatalogSort(value?: string): ProductCatalogSort {
  return value === "name" ? "name" : "newest";
}

export function productCatalogOrderBy(
  sort: ProductCatalogSort,
): [{ name: "asc" }, { id: "asc" }] | [{ createdAt: "desc" }, { id: "desc" }] {
  return sort === "name"
    ? [{ name: "asc" }, { id: "asc" }]
    : [{ createdAt: "desc" }, { id: "desc" }];
}
