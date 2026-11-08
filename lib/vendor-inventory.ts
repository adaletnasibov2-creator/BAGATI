type StockRow = { quantity: number; reserved: number; lowStockThreshold: number };

type ProductStock = {
  inventory: StockRow[];
  variants: { inventory: StockRow[] }[];
};

export function matchesProductStockFilter(product: ProductStock, filter: "low" | "out"): boolean {
  const rows = product.variants.length
    ? product.variants.flatMap((variant) => variant.inventory)
    : product.inventory;
  const available = rows.map((row) => Math.max(0, row.quantity - row.reserved));
  return filter === "out"
    ? available.length === 0 || available.every((quantity) => quantity === 0)
    : rows.some((row, index) => available[index] !== 0 && available[index]! <= row.lowStockThreshold);
}

export function countProductsWithLowStock(products: readonly ProductStock[]): number {
  return products.filter((product) => {
    const rows = product.variants.length
      ? product.variants.flatMap((variant) => variant.inventory)
      : product.inventory;
    return rows.some((row) => Math.max(0, row.quantity - row.reserved) <= row.lowStockThreshold);
  }).length;
}
