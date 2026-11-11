import { Prisma } from "@prisma/client";
import type { ImportRowCheck } from "@/lib/product-import";
import { normalizeSku } from "@/lib/sku-normalization";
import { generateProductCode } from "@/lib/product-code";

type ImportSkuTransaction = Pick<Prisma.TransactionClient, "$queryRaw">;

export class CatalogSkuConflictError extends Error {
  constructor(readonly scope: "PRODUCT" | "VARIANT") {
    super("CATALOG_SKU_CONFLICT");
    this.name = "CatalogSkuConflictError";
  }
}

export function isSkuUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") return false;
  const meta = "meta" in error ? error.meta : null;
  if (!meta || typeof meta !== "object" || !("target" in meta)) return false;
  const target = meta.target;
  return (Array.isArray(target) ? target.join(" ") : String(target)).toLowerCase().includes("sku");
}

export async function findExistingProductSkuMatches(
  tx: ImportSkuTransaction,
  storeId: string,
  skus: readonly string[],
  excludeProductId?: string,
): Promise<Array<{ id: string; sku: string; incomingSku: string }>> {
  const candidates = [...new Set(skus.flatMap((sku) => {
    const canonical = normalizeSku(sku);
    return canonical ? [canonical] : [];
  }))];
  if (!candidates.length) return [];
  const values = candidates.map((sku) => Prisma.sql`(${sku}::text)`);
  return tx.$queryRaw(Prisma.sql`
    SELECT product."id", product."sku", incoming."sku" AS "incomingSku"
    FROM (VALUES ${Prisma.join(values)}) AS incoming("sku")
    JOIN "Product" AS product
      ON product."storeId" = ${storeId}
      ${excludeProductId ? Prisma.sql`AND product."id" <> ${excludeProductId}` : Prisma.empty}
      AND (translate(btrim(normalize(product."sku", NFKC), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') COLLATE "C")
        = (translate(btrim(normalize(incoming."sku", NFKC), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') COLLATE "C")
    WHERE product."sku" IS NOT NULL
  `);
}

export async function findExistingVariantSkuKeys(
  tx: ImportSkuTransaction,
  skus: readonly string[],
  excludeVariantIds: readonly string[] = [],
): Promise<Set<string>> {
  const candidates = [...new Set(skus.flatMap((sku) => {
    const canonical = normalizeSku(sku);
    return canonical ? [canonical] : [];
  }))];
  if (!candidates.length) return new Set();
  const values = candidates.map((sku) => Prisma.sql`(${sku}::text)`);
  const matches = await tx.$queryRaw<Array<{ incomingSku: string }>>(Prisma.sql`
    SELECT DISTINCT incoming."sku" AS "incomingSku"
    FROM (VALUES ${Prisma.join(values)}) AS incoming("sku")
    JOIN "ProductVariant" AS variant
      ON (translate(btrim(normalize(variant."sku", NFKC), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') COLLATE "C")
        = (translate(btrim(normalize(incoming."sku", NFKC), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') COLLATE "C")
      ${excludeVariantIds.length ? Prisma.sql`AND variant."id" NOT IN (${Prisma.join(excludeVariantIds)})` : Prisma.empty}
    WHERE variant."sku" IS NOT NULL
  `);
  return new Set(matches.flatMap(({ incomingSku }) => {
    const key = normalizeSku(incomingSku);
    return key ? [key] : [];
  }));
}

export async function withImportPersistenceSavepoint<T>(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  persist: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  await tx.$executeRaw`SAVEPOINT catalog_import_persistence`;
  try {
    const value = await persist();
    await tx.$executeRaw`RELEASE SAVEPOINT catalog_import_persistence`;
    return { ok: true, value };
  } catch (error) {
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT catalog_import_persistence`;
    await tx.$executeRaw`RELEASE SAVEPOINT catalog_import_persistence`;
    return { ok: false, error };
  }
}

export function failedChunkRowOutcomes<T extends { errors: string[] }>(
  rows: readonly T[],
  explanation: string,
): Array<Omit<T, "status" | "productId" | "errors"> & { status: "FAILED"; productId: null; errors: string[] }> {
  return rows.map((row) => {
    const fields: Omit<T, "status" | "productId" | "errors"> = row;
    return {
      ...fields,
      status: "FAILED",
      productId: null,
      errors: [...row.errors, explanation],
    };
  });
}

function productSlug(name: string, id: string): string {
  const base = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "mehsul";
  return `${base}-${id.slice(0, 8)}`;
}

export async function persistCatalogImportChunk(input: {
  tx: Prisma.TransactionClient;
  storeId: string;
  actorUserId: string;
  rows: ImportRowCheck[];
}): Promise<{ created: number; updated: number; productIds: Map<number, string> }> {
  const valid = input.rows.filter((row) => row.status === "VALID" || row.status === "WARNING");
  const createRows = valid.filter((row) => row.action === "create");
  const updateRows = valid.filter((row) => row.action === "update" && row.existingId);
  const productIds = new Map<number, string>();
  const inventoryRows: Prisma.InventoryCreateManyInput[] = [];
  const adjustmentRows: Prisma.InventoryAdjustmentCreateManyInput[] = [];
  const variantRows: Prisma.ProductVariantCreateManyInput[] = [];

  const productsToCreate = createRows.map((row) => {
    const id = crypto.randomUUID();
    productIds.set(row.index, id);
    return {
      id,
      storeId: input.storeId,
      name: row.product.name,
      slug: productSlug(row.product.name, id),
      description: row.product.description,
      price: new Prisma.Decimal(row.product.price),
      discountPrice: row.product.discountPrice === null ? null : new Prisma.Decimal(row.product.discountPrice),
      sku: row.product.sku || generateProductCode(id),
      categoryId: row.product.categoryId,
      brandId: row.product.brandId,
      images: row.product.images,
      status: "DRAFT" as const,
    };
  });
  if (productsToCreate.length) {
    const created = await input.tx.product.createMany({ data: productsToCreate });
    if (created.count !== productsToCreate.length) throw new Error("IMPORT_PRODUCT_CREATE_COUNT_MISMATCH");
  }

  for (const row of createRows) {
    const productId = productIds.get(row.index)!;
    const quantity = row.product.quantity ?? 0;
    const inventoryId = crypto.randomUUID();
    inventoryRows.push({
      id: inventoryId,
      productId,
      variantId: null,
      quantity,
      lowStockThreshold: row.product.lowStockThreshold,
    });
    if (quantity > 0) adjustmentRows.push({
      id: crypto.randomUUID(),
      inventoryId,
      actorUserId: input.actorUserId,
      delta: quantity,
      previousQuantity: 0,
      newQuantity: quantity,
      reason: "Toplu idxalla ilkin stok yaradıldı",
    });
    for (const variant of row.product.variants) {
      const variantId = crypto.randomUUID();
      variantRows.push({
        id: variantId,
        productId,
        name: variant.name,
        options: variant.options as Prisma.InputJsonValue,
        sku: variant.sku || null,
        price: variant.price == null ? null : new Prisma.Decimal(variant.price),
        discountPrice: variant.discountPrice == null ? null : new Prisma.Decimal(variant.discountPrice),
        images: variant.images ?? [],
      });
      const variantInventoryId = crypto.randomUUID();
      const variantQuantity = variant.quantity ?? 0;
      inventoryRows.push({
        id: variantInventoryId,
        productId,
        variantId,
        quantity: variantQuantity,
        lowStockThreshold: variant.lowStockThreshold ?? 5,
      });
      if (variantQuantity > 0) adjustmentRows.push({
        id: crypto.randomUUID(),
        inventoryId: variantInventoryId,
        actorUserId: input.actorUserId,
        delta: variantQuantity,
        previousQuantity: 0,
        newQuantity: variantQuantity,
        reason: "Toplu idxalla ilkin variant stoku yaradıldı",
      });
    }
  }
  if (variantRows.length) await input.tx.productVariant.createMany({ data: variantRows });
  if (inventoryRows.length) await input.tx.inventory.createMany({ data: inventoryRows });
  if (adjustmentRows.length) await input.tx.inventoryAdjustment.createMany({ data: adjustmentRows });

  if (updateRows.length) {
    const updateValues = updateRows.map((row) => {
      const product = row.product;
      const images = product.images.length
        ? Prisma.sql`ARRAY[${Prisma.join(product.images.map((image) => Prisma.sql`${image}::text`))}]::text[]`
        : Prisma.sql`NULL::text[]`;
      return Prisma.sql`(
        ${row.existingId}::text,
        ${product.name}::text,
        ${product.description}::text,
        ${new Prisma.Decimal(product.price)}::numeric,
        ${product.discountPrice === null ? null : new Prisma.Decimal(product.discountPrice)}::numeric,
        ${product.categoryId}::text,
        ${product.brandId}::text,
        ${images},
        ${product.images.length > 0}::boolean
      )`;
    });
    const updated = await input.tx.$executeRaw(Prisma.sql`
      UPDATE "Product" AS product
      SET "name" = incoming.name,
          "description" = incoming.description,
          "price" = incoming.price,
          "discountPrice" = incoming."discountPrice",
          "categoryId" = incoming."categoryId",
          "brandId" = incoming."brandId",
          "images" = CASE WHEN incoming."replaceImages" THEN incoming.images ELSE product."images" END,
          "updatedAt" = CURRENT_TIMESTAMP
      FROM (VALUES ${Prisma.join(updateValues)}) AS incoming(
        id, name, description, price, "discountPrice", "categoryId", "brandId", images, "replaceImages"
      )
      WHERE product."id" = incoming.id AND product."storeId" = ${input.storeId}
    `);
    if (updated !== updateRows.length) throw new Error("IMPORT_UPDATE_TARGET_CHANGED");
  }

  const updateIds = updateRows.map((row) => row.existingId!);
  const existingInventory = updateIds.length
    ? await input.tx.inventory.findMany({
      where: { productId: { in: updateIds }, variantId: null },
    })
    : [];
  const inventoryByProduct = new Map(existingInventory.map((inventory) => [inventory.productId, inventory]));
  const quantityUpdates = updateRows.flatMap((row) => {
    const inventory = inventoryByProduct.get(row.existingId!);
    const quantity = row.product.quantity;
    if (!inventory || quantity === null) return [];
    if (quantity < inventory.reserved) throw new Error("IMPORT_STOCK_BELOW_RESERVED");
    if (quantity === inventory.quantity && row.product.lowStockThreshold === inventory.lowStockThreshold) return [];
    return [{ row, inventory, quantity, delta: quantity - inventory.quantity }];
  });
  if (quantityUpdates.length) {
    const updateValues = quantityUpdates.map(({ inventory, quantity, row }) => Prisma.sql`(
      ${inventory.id}::text,
      ${quantity}::integer,
      ${row.product.lowStockThreshold}::integer
    )`);
    const updated = await input.tx.$executeRaw(Prisma.sql`
      UPDATE "Inventory" AS inventory
      SET "quantity" = incoming.quantity,
          "lowStockThreshold" = incoming."lowStockThreshold",
          "updatedAt" = CURRENT_TIMESTAMP
      FROM (VALUES ${Prisma.join(updateValues)}) AS incoming(id, quantity, "lowStockThreshold")
      WHERE inventory."id" = incoming.id
    `);
    if (updated !== quantityUpdates.length) throw new Error("IMPORT_INVENTORY_TARGET_CHANGED");
    const stockAdjustments = quantityUpdates.filter(({ delta }) => delta !== 0);
    if (stockAdjustments.length) await input.tx.inventoryAdjustment.createMany({
      data: stockAdjustments.map(({ inventory, quantity, delta }) => ({
        id: crypto.randomUUID(),
        inventoryId: inventory.id,
        actorUserId: input.actorUserId,
        delta,
        previousQuantity: inventory.quantity,
        newQuantity: quantity,
        reason: "Toplu idxalla stok yeniləndi",
      })),
    });
  }

  return {
    created: createRows.length,
    updated: updateRows.length,
    productIds,
  };
}
