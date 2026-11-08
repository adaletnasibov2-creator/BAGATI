import { NextRequest, NextResponse } from "next/server";
import { csrfRejection } from "@/lib/csrf";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { categoriesWithOtherLast } from "@/lib/category-order";
import { checkImportRows, isSafeImportImageUrl } from "@/lib/product-import";
import { prisma } from "@/lib/prisma";
import { isOwnedStoreAssetUrl } from "@/lib/storage/store-assets";
import { readBoundedRequestBytes } from "@/lib/request-body";
import { CatalogSkuConflictError, findExistingProductSkuMatches, findExistingVariantSkuKeys, isSkuUniqueViolation } from "@/lib/catalog-import-persistence";

export const dynamic = "force-dynamic";
const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const importSchema = z.object({
  action: z.enum(["validate", "import"]),
  mode: z.enum(["create", "update", "mixed"]).default("create"),
  sourceName: z.string().trim().min(1).max(255),
  mapping: z.record(z.string().max(120)),
  rows: z.array(z.record(z.string().max(20_000))).min(1).max(1000),
}).strict();

const slugify = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mehsul";

function safeImageForStore(storeId: string, value: string) {
  return isSafeImportImageUrl(value) && (!value.startsWith("/") || isOwnedStoreAssetUrl(storeId, value));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;

  let bytes: Uint8Array;
  let raw: string;
  try {
    bytes = await readBoundedRequestBytes(request, MAX_REQUEST_BYTES);
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof Error && error.message === "BODY_TOO_LARGE") return NextResponse.json({ error: "İdxal sorğusu 12 MB-dan böyük ola bilməz" }, { status: 413 });
    return NextResponse.json({ error: "İdxal sorğusu oxunmadı" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "İdxal məlumatı yanlışdır" }, { status: 400 });
  }
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Fayl, sütun uyğunlaşdırması və sətirləri yoxlayın" }, { status: 422 });

  const { storeId } = await params;
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true } });
  if (!store) return NextResponse.json({ error: "Mağaza tapılmadı" }, { status: 404 });

  const { action, mode, sourceName, mapping, rows } = parsed.data;
  if (!mapping.name || !mapping.price || !mapping.category) {
    return NextResponse.json({ error: "Məhsul adı, qiymət və kateqoriya sütunlarını uyğunlaşdırın" }, { status: 422 });
  }

  const [categoryRows, brands, existing] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true, slug: true } }),
    prisma.brand.findMany({ select: { id: true, name: true } }),
    prisma.product.findMany({ where: { storeId }, select: { id: true, sku: true } }),
  ]);
  const categories = categoriesWithOtherLast(categoryRows);
  const importCheckInput = {
    rows,
    mapping,
    mode,
    categories,
    brands,
    existing,
  } as const;
  const preliminaryRows = checkImportRows(importCheckInput);
  const candidateVariantSkus = preliminaryRows.flatMap((row) => row.product.variants.flatMap((variant) => variant.sku ? [variant.sku] : []));
  const existingVariantSkuKeys = await findExistingVariantSkuKeys(prisma, candidateVariantSkus);
  const checked = checkImportRows({ ...importCheckInput, existingVariantSkuKeys }).map((row) => {
    const imageUrls = [...row.product.images, ...row.product.variants.flatMap((variant) => variant.images ?? [])];
    if (imageUrls.some((url) => !safeImageForStore(storeId, url))) {
      return { ...row, status: "INVALID" as const, errors: [...row.errors, "Şəkil yalnız HTTPS və ya bu mağazaya aid yüklənmiş resurs olmalıdır"] };
    }
    return row;
  });
  const validRows = checked.filter((row) => row.status !== "INVALID");
  if (action === "validate") {
    return NextResponse.json({
      rows: checked,
      validCount: validRows.length,
      invalidCount: checked.length - validRows.length,
      warningCount: checked.filter((row) => row.status === "WARNING").length,
      mode,
    });
  }
  if (validRows.length === 0) {
    return NextResponse.json({ error: "İdxal üçün uyğun sətir yoxdur", rows: checked, created: 0, updated: 0, errorCount: checked.length }, { status: 422 });
  }

  const record = await prisma.productImport.create({
    data: {
      storeId,
      sourceName,
      status: "VALIDATING",
      columnMapping: { ...mapping, mode, format: sourceName.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv" },
    },
    select: { id: true },
  });
  try {
    const result = await prisma.$transaction(async (tx) => {
      let created = 0;
      let updated = 0;
      for (const row of validRows) {
        const value = row.product;
        if (row.action === "update" && row.existingId) {
          const changed = await tx.product.updateMany({
            where: { id: row.existingId, storeId },
            data: {
              name: value.name,
              description: value.description,
              price: new Prisma.Decimal(value.price),
              discountPrice: value.discountPrice === null ? null : new Prisma.Decimal(value.discountPrice),
              categoryId: value.categoryId,
              brandId: value.brandId,
              ...(value.images.length ? { images: value.images } : {}),
            },
          });
          if (changed.count !== 1) throw new Error("PRODUCT_SCOPE_CHANGED");
          const inventory = await tx.inventory.findFirst({ where: { productId: row.existingId, variantId: null } });
          if (typeof value.quantity === "number" && inventory) {
            const changedInventory = await tx.inventory.updateMany({
              where: { id: inventory.id, quantity: inventory.quantity, reserved: { lte: value.quantity } },
              data: { quantity: value.quantity, lowStockThreshold: value.lowStockThreshold },
            });
            if (changedInventory.count !== 1) throw new Error("STOCK_RESERVED_OR_CHANGED");
            if (inventory.quantity !== value.quantity) {
              await tx.inventoryAdjustment.create({
                data: {
                  inventoryId: inventory.id,
                  actorUserId: admin.id,
                  delta: value.quantity - inventory.quantity,
                  previousQuantity: inventory.quantity,
                  newQuantity: value.quantity,
                  reason: "Admin məhsul idxalı",
                },
              });
            }
          } else if (typeof value.quantity === "number") {
            const createdInventory = await tx.inventory.create({ data: { productId: row.existingId, quantity: value.quantity, lowStockThreshold: value.lowStockThreshold } });
            if (value.quantity > 0) {
              await tx.inventoryAdjustment.create({
                data: { inventoryId: createdInventory.id, actorUserId: admin.id, delta: value.quantity, previousQuantity: 0, newQuantity: value.quantity, reason: "Admin idxalı ilə ilkin stok" },
              });
            }
          }
          updated++;
          continue;
        }

        if (value.sku && (await findExistingProductSkuMatches(tx, storeId, [value.sku])).length) {
          throw new CatalogSkuConflictError("PRODUCT");
        }
        const variantSkus = value.variants.flatMap((variant) => variant.sku ? [variant.sku] : []);
        if (variantSkus.length) {
          const existingSkus = await findExistingVariantSkuKeys(tx, variantSkus);
          if (variantSkus.some((sku) => existingSkus.has(sku))) throw new CatalogSkuConflictError("VARIANT");
        }
        const product = await tx.product.create({
          data: {
            storeId,
            name: value.name,
            slug: `${slugify(value.name)}-${crypto.randomUUID().slice(0, 8)}`,
            description: value.description,
            price: new Prisma.Decimal(value.price),
            discountPrice: value.discountPrice === null ? null : new Prisma.Decimal(value.discountPrice),
            sku: value.sku,
            categoryId: value.categoryId,
            brandId: value.brandId,
            images: value.images,
            status: "DRAFT",
          },
          select: { id: true },
        });
        const inventory = await tx.inventory.create({
          data: {
            productId: product.id,
            quantity: value.variants.length ? 0 : (value.quantity ?? 0),
            lowStockThreshold: value.lowStockThreshold,
          },
        });
        const createdQuantity = value.quantity ?? 0;
        if (!value.variants.length && createdQuantity > 0) {
          await tx.inventoryAdjustment.create({
            data: { inventoryId: inventory.id, actorUserId: admin.id, delta: createdQuantity, previousQuantity: 0, newQuantity: createdQuantity, reason: "Admin idxalı ilə ilkin stok" },
          });
        }
        for (const variant of value.variants) {
          const createdVariant = await tx.productVariant.create({
            data: {
              productId: product.id,
              name: variant.name,
              options: variant.options as Prisma.InputJsonValue,
              sku: variant.sku || null,
              price: variant.price == null ? null : new Prisma.Decimal(variant.price),
              discountPrice: variant.discountPrice == null ? null : new Prisma.Decimal(variant.discountPrice),
              images: variant.images ?? [],
            },
            select: { id: true },
          });
          const quantity = variant.quantity ?? 0;
          const variantInventory = await tx.inventory.create({
            data: { productId: product.id, variantId: createdVariant.id, quantity, lowStockThreshold: variant.lowStockThreshold ?? 5 },
          });
          if (quantity > 0) {
            await tx.inventoryAdjustment.create({
              data: { inventoryId: variantInventory.id, actorUserId: admin.id, delta: quantity, previousQuantity: 0, newQuantity: quantity, reason: "Admin idxalı ilə variant stoku" },
            });
          }
        }
        created++;
      }

      const errors = checked.filter((row) => row.status === "INVALID").map((row) => ({
        index: row.index,
        errors: row.errors,
        sku: row.product.sku,
        name: row.product.name,
      }));
      await tx.productImport.update({
        where: { id: record.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          result: { rowCount: checked.length, successCount: created + updated, created, updated, errorCount: errors.length, errors, mode },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "ADMIN_PRODUCT_IMPORT",
          entityType: "ProductImport",
          entityId: record.id,
          metadata: { storeId, created, updated, errorCount: errors.length, sourceName },
        },
      });
      return { created, updated, errors };
    }, { maxWait: 10_000, timeout: 60_000 });

    return NextResponse.json({
      created: result.created,
      updated: result.updated,
      successCount: result.created + result.updated,
      errorCount: result.errors.length,
      rows: checked,
      mode,
    }, { status: result.errors.length ? 207 : 201 });
  } catch (error) {
    const code = error instanceof Error && error.message === "STOCK_RESERVED_OR_CHANGED"
      ? "Stok eyni vaxtda dəyişib və ya rezerv edilmiş saydan aşağıdır; heç bir məhsul idxal edilmədi."
      : "İdxal tranzaksiyası uğursuz oldu; heç bir məhsul dəyişikliyi saxlanılmadı.";
    await prisma.productImport.update({
      where: { id: record.id },
      data: { status: "FAILED", completedAt: new Date(), result: { rowCount: checked.length, successCount: 0, errorCount: checked.length, errors: [code], mode } },
    });
    if (error instanceof CatalogSkuConflictError || isSkuUniqueViolation(error)) {
      return NextResponse.json({ error: "SKU və ya variant SKU artıq başqa məhsulda istifadə olunur; idxal tranzaksiyası geri qaytarıldı." }, { status: 409 });
    }
    return NextResponse.json({ error: code }, { status: 409 });
  }
}
