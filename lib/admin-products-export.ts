/**
 * ADMIN-3-EXPORTS-1: the admin products CSV (/api/admin/products/export) with the list export's protections
 * (lib/admin-list-export.ts): at most ADMIN_LIST_EXPORT_MAX_ROWS rows (one extra row read only tells "truncated",
 * signalled like the list export through X-Export-Rows / X-Export-Truncated, no message), the shared rate limit and
 * one ADMIN_LIST_EXPORT audit row. Filters and the CSV format (columns, BOM, CRLF, formula-safe cells, images and
 * variants as JSON) are exactly as before; the rows are read in the same 250-row id-cursor pages, but bounded.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { adminSearchContains } from "@/lib/admin-list-where";
import { escapeAdminReportCsvCell } from "@/lib/admin-report-csv";
import { ADMIN_LIST_EXPORT_MAX_ROWS, capRows } from "@/lib/admin-power-1";

export type ProductExportFilters = { q?: string; storeId?: string; categoryId?: string; status?: "DRAFT" | "ACTIVE" | "ARCHIVED" };

export const PRODUCT_EXPORT_HEADER = ["id", "name", "sku", "description", "category", "store", "price", "discountPrice", "status", "stock", "images", "variants"] as const;
const PAGE = 250;

/** The same filter as before (status, store, category incl. its subcategories, search on name / SKU / store name). */
export function productExportWhere({ q, storeId, categoryId, status }: ProductExportFilters): Prisma.ProductWhereInput {
  return {
    ...(status ? { status } : {}),
    ...(storeId ? { storeId } : {}),
    ...(categoryId ? { category: { OR: [{ id: categoryId }, { parentId: categoryId }] } } : {}),
    ...(q ? { OR: [
      { name: adminSearchContains(q) },
      { sku: adminSearchContains(q) },
      { store: { name: adminSearchContains(q) } },
    ] } : {}),
  };
}

const exportSelect = {
  id: true, name: true, sku: true, description: true, price: true, discountPrice: true, status: true, images: true,
  category: { select: { name: true } },
  store: { select: { name: true } },
  inventory: { select: { quantity: true } },
  variants: { select: { name: true, sku: true, options: true, price: true, discountPrice: true, inventory: { select: { quantity: true } } } },
} as const;
type ExportProduct = Prisma.ProductGetPayload<{ select: typeof exportSelect }>;
type Db = Pick<PrismaClient, "product">;

/** Reads at most `max + 1` products in 250-row id-cursor pages (ordered by id, as before). */
export async function readProductExportRows(db: Db, where: Prisma.ProductWhereInput, max = ADMIN_LIST_EXPORT_MAX_ROWS): Promise<ExportProduct[]> {
  const rows: ExportProduct[] = [];
  let cursor: string | undefined;
  while (rows.length <= max) {
    const want = Math.min(PAGE, max + 1 - rows.length);
    const page = await db.product.findMany({
      where, orderBy: { id: "asc" }, take: want,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: exportSelect,
    }) as ExportProduct[];
    rows.push(...page);
    if (page.length < want) break; // last page
    cursor = page[page.length - 1].id;
  }
  return rows;
}

/** One CSV line per product, exactly the old format. */
export function productExportLine(product: ExportProduct): string {
  const variants = product.variants.map((variant) => ({
    name: variant.name,
    sku: variant.sku,
    options: variant.options,
    price: variant.price?.toString() ?? null,
    discountPrice: variant.discountPrice?.toString() ?? null,
    stock: variant.inventory.reduce((sum, item) => sum + item.quantity, 0),
  }));
  return [
    product.id,
    product.name,
    product.sku ?? "",
    product.description ?? "",
    product.category?.name ?? "",
    product.store.name,
    product.price.toString(),
    product.discountPrice?.toString() ?? "",
    product.status,
    String(product.inventory.reduce((sum, item) => sum + item.quantity, 0)),
    JSON.stringify(product.images),
    JSON.stringify(variants),
  ].map(escapeAdminReportCsvCell).join(",");
}

/** The whole file as before: BOM, header line, then one CRLF-terminated line per product. */
export function productExportCsv(products: readonly ExportProduct[]): string {
  const header = PRODUCT_EXPORT_HEADER.map(escapeAdminReportCsvCell).join(",");
  return `﻿${header}\r\n${products.map((product) => `${productExportLine(product)}\r\n`).join("")}`;
}

/** Filtered, bounded products CSV plus the facts for the audit row. */
export async function buildProductsExport(db: Db, filters: ProductExportFilters) {
  const { rows, truncated } = capRows(await readProductExportRows(db, productExportWhere(filters)));
  const filterKeys = (["storeId", "categoryId", "status"] as const).filter((key) => Boolean(filters[key])).sort();
  return { csv: productExportCsv(rows), rowCount: rows.length, truncated, filterKeys: [...filterKeys], searched: Boolean(filters.q) };
}
