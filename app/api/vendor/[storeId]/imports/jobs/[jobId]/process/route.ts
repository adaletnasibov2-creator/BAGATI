import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireStoreAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  applyImportOutcomes,
  duplicateImportRowNumbers,
  finalImportJobStatus,
  normalizeImportSku,
  shouldSkipExistingImportProduct,
  type CatalogImportMode,
} from "@/lib/catalog-import-jobs";
import {
  findExistingProductSkuMatches,
  findExistingVariantSkuKeys,
  failedChunkRowOutcomes,
  persistCatalogImportChunk,
  withImportPersistenceSavepoint,
} from "@/lib/catalog-import-persistence";
import { checkImportRows, isSafeImportImageUrl, parseImportVariants, type ImportMode } from "@/lib/product-import";
import { categoriesWithOtherLast } from "@/lib/category-order";
import { isOwnedStoreAssetUrl } from "@/lib/storage/store-assets";
import {
  assertFeature,
  EntitlementError,
  entitlementErrorResponse,
  lockStoreEntitlement,
} from "@/lib/subscription-entitlements";

const db = prisma;
const CHUNK_PERSISTENCE_FAILURE_MESSAGE = "Hissə atomik saxlanmadı; heç bir sətir yazılmayıb. Məlumatı düzəldin və ya yenidən cəhd edin.";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ storeId: string; jobId: string }> },
) {
  const { storeId, jobId } = await context.params;
  const access = await requireStoreAccess(storeId);
  if (!access || access.user.role !== "VENDOR") {
    return NextResponse.json({ error: "Mağazaya giriş icazəsi yoxdur" }, { status: 403 });
  }
  try {
    const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const entitlement = await lockStoreEntitlement(tx, access.storeId);
      assertFeature(entitlement, "BULK_IMPORT");
      await tx.$queryRaw`SELECT "id" FROM "ImportJob" WHERE "id" = ${jobId} AND "storeId" = ${access.storeId} FOR UPDATE`;
      const job = await tx.importJob.findFirst({ where: { id: jobId, storeId: access.storeId } });
      if (!job) return { error: "NOT_FOUND" as const };
      if (job.status !== "QUEUED" && job.status !== "PROCESSING") return { error: "INVALID_STATE" as const };

      const rows = await tx.importJobRow.findMany({
        where: { jobId, status: "PENDING" },
        orderBy: { rowNumber: "asc" },
        take: job.chunkSize,
        select: { id: true, rowNumber: true, sourceData: true },
      });
      if (!rows.length) {
        const status = finalImportJobStatus({
          totalRows: job.totalRows,
          processedRows: job.processedRows,
          createdRows: job.createdRows,
          updatedRows: job.updatedRows,
          skippedRows: job.skippedRows,
          failedRows: job.failedRows,
        });
        const updated = await tx.importJob.update({
          where: { id: jobId },
          data: {
            status,
            startedAt: job.startedAt ?? new Date(),
            completedAt: status === "PROCESSING" ? null : new Date(),
          },
        });
        return { job: updated, processedThisCall: 0 };
      }

      const mapping = job.mapping as Record<string, string>;
      const rawRows: Record<string, unknown>[] = rows.map((row: { sourceData: unknown }) => row.sourceData as Record<string, unknown>);
      const skuColumn = mapping.sku;
      const skuRows = skuColumn
        ? rows.map((row: { rowNumber: number; sourceData: unknown }) => ({
          rowNumber: row.rowNumber,
          normalizedSku: normalizeImportSku((row.sourceData as Record<string, unknown>)[skuColumn]),
        }))
        : [];
      const skuKeys = [...new Set(skuRows.flatMap((row: { normalizedSku: string | null }) => row.normalizedSku ? [row.normalizedSku] : []))];
      const firstSkuRows = skuKeys.length
        ? await tx.importJobSku.findMany({
          where: { jobId, normalizedSku: { in: skuKeys } },
          select: { normalizedSku: true, firstRowNumber: true },
        })
        : [];
      const duplicateRows = duplicateImportRowNumbers(
        skuRows,
        new Map(firstSkuRows.map((row: { normalizedSku: string; firstRowNumber: number }) => [row.normalizedSku, row.firstRowNumber])),
      );

      const skuValues = [...new Set(rawRows.flatMap((row) => {
        const value = skuColumn ? row[skuColumn] : null;
        const candidate = value === null || value === undefined ? "" : String(value).trim();
        return candidate ? [candidate] : [];
      }))];
      const productMatches = await findExistingProductSkuMatches(tx, access.storeId, skuValues);
      const productIds = productMatches.map((product: { id: string }) => product.id);
      const variantSkuValues = mapping.variants
        ? rawRows.flatMap((row) => parseImportVariants(String(row[mapping.variants] ?? "")).variants.flatMap((variant) => variant.sku ? [variant.sku] : []))
        : [];
      const existingVariantSkuKeys = await findExistingVariantSkuKeys(tx, variantSkuValues);
      if (productIds.length) {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Inventory"
          WHERE "productId" IN (${Prisma.join(productIds)})
            AND "variantId" IS NULL
          ORDER BY "id"
          FOR UPDATE
        `);
      }
      const [categoryRows, brands, existing] = await Promise.all([
        tx.category.findMany({ where: { isActive: true }, select: { id: true, name: true, slug: true } }),
        tx.brand.findMany({ select: { id: true, name: true } }),
        productIds.length
          ? tx.product.findMany({
            where: { id: { in: productIds }, storeId: access.storeId },
            select: {
              id: true,
              sku: true,
              inventory: { where: { variantId: null }, select: { quantity: true, reserved: true }, take: 1 },
            },
          })
          : Promise.resolve([]),
      ]);
      const checked = checkImportRows({
        rows: rawRows,
        mapping,
        mode: (job.mode === "skip" ? "mixed" : job.mode) as ImportMode,
        categories: categoriesWithOtherLast(categoryRows),
        brands,
        existing: existing.map((product) => ({ ...product, inventory: product.inventory[0] ?? null })),
        existingVariantSkuKeys,
        isImageUrlAllowed: (url) => isSafeImportImageUrl(url) && isOwnedStoreAssetUrl(access.storeId, url),
      }).map((row, index) => {
        row.index = rows[index].rowNumber;
        if (duplicateRows.has(rows[index].rowNumber)) {
          return {
            ...row,
            status: "INVALID" as const,
            errors: [...row.errors, "Fayl daxilində bu SKU daha əvvəl göstərilib"],
          };
        }
        if (shouldSkipExistingImportProduct(job.mode as CatalogImportMode, row.action)) {
          return {
            ...row,
            status: "SKIPPED" as const,
            errors: [],
            warnings: [...row.warnings, "Mövcud SKU skip rejiminə görə dəyişdirilmədi"],
          };
        }
        return row;
      });
      const createCount = checked.filter((row) => (row.status === "VALID" || row.status === "WARNING") && row.action === "create").length;
      const activeLimit = entitlement.limits?.activeProducts ?? 0;
      if (createCount && !activeLimit) throw new Error("IMPORT_SUBSCRIPTION_REQUIRED");
      if (createCount) {
        const activeCount = await tx.product.count({ where: { storeId: access.storeId, status: "ACTIVE" } });
        if (activeCount + createCount > activeLimit) throw new Error("IMPORT_PRODUCT_LIMIT_REACHED");
      }

      const persisted = await withImportPersistenceSavepoint(tx, () => persistCatalogImportChunk({
        tx,
        storeId: access.storeId,
        actorUserId: access.user.id,
        rows: checked,
      }));
      if (!persisted.ok) {
        console.error("catalog import persistence rolled back to savepoint", {
          jobId,
          errorName: persisted.error instanceof Error ? persisted.error.name : "UnknownError",
        });
      }

      const outcomes = !persisted.ok
        ? failedChunkRowOutcomes(
          checked,
          CHUNK_PERSISTENCE_FAILURE_MESSAGE,
        ).map((outcome) => ({ row: outcome, status: outcome.status, productId: outcome.productId, errors: outcome.errors }))
        : checked.map((row) => {
          if (row.status === "INVALID") return { row, status: "FAILED" as const, productId: null, errors: row.errors };
          if (row.status === "SKIPPED") return { row, status: "SKIPPED" as const, productId: row.existingId ?? null, errors: row.errors };
          return {
            row,
            status: row.action === "create" ? "CREATED" as const : "UPDATED" as const,
            productId: row.action === "create" ? persisted.value.productIds.get(row.index) ?? null : row.existingId ?? null,
            errors: row.errors,
          };
        });
      const rowIdsByNumber = new Map(rows.map((row: { id: string; rowNumber: number }) => [row.rowNumber, row.id]));
      const processedAt = new Date();
      const values = outcomes.map(({ row, status, productId, errors }) => Prisma.sql`(
        ${rowIdsByNumber.get(row.index)}::text,
        ${status}::"ImportJobRowStatus",
        ${JSON.stringify(errors)}::jsonb,
        ${JSON.stringify(row.warnings)}::jsonb,
        ${productId}::text,
        ${processedAt}::timestamp
      )`);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "ImportJobRow" AS jobRow
        SET "status" = incoming.status,
            "errors" = incoming.errors,
            "warnings" = incoming.warnings,
            "productId" = incoming."productId",
            "processedAt" = incoming."processedAt",
            "updatedAt" = CURRENT_TIMESTAMP
        FROM (VALUES ${Prisma.join(values)}) AS incoming(id, status, errors, warnings, "productId", "processedAt")
        WHERE jobRow."id" = incoming.id AND jobRow."jobId" = ${jobId} AND jobRow."status" = 'PENDING'
      `);
      const counters = applyImportOutcomes(
        {
          totalRows: job.totalRows,
          processedRows: job.processedRows,
          createdRows: job.createdRows,
          updatedRows: job.updatedRows,
          skippedRows: job.skippedRows,
          failedRows: job.failedRows,
        },
        outcomes.map((outcome) => outcome.status),
      );
      const status = finalImportJobStatus(counters);
      const updatedJob = await tx.importJob.update({
        where: { id: jobId },
        data: {
          ...counters,
          status,
          startedAt: job.startedAt ?? new Date(),
          completedAt: status === "PROCESSING" ? null : new Date(),
          lastError: persisted.ok ? null : CHUNK_PERSISTENCE_FAILURE_MESSAGE,
        },
      });
      return {
        job: updatedJob,
        processedThisCall: rows.length,
        rowResults: outcomes.map(({ row, status, errors }) => ({
          rowNumber: row.index,
          status,
          errors,
          warnings: row.warnings,
        })),
        persistenceError: persisted.ok ? undefined : "CHUNK_PERSISTENCE_FAILED",
      };
    });

    if (result.error === "NOT_FOUND") return NextResponse.json({ error: "İdxal işi tapılmadı" }, { status: 404 });
    if (result.error === "INVALID_STATE") return NextResponse.json({ error: "İdxal işi emala hazır deyil" }, { status: 409 });
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (error instanceof EntitlementError) return entitlementErrorResponse(error);
    if (code === "IMPORT_SUBSCRIPTION_REQUIRED") {
      return NextResponse.json({ error: "Məhsul idxalı üçün aktiv plan tələb olunur", code: "SUBSCRIPTION_REQUIRED" }, { status: 409 });
    }
    if (code === "IMPORT_PRODUCT_LIMIT_REACHED") {
      return NextResponse.json({ error: "Paket məhsul limitinə çatdınız", code: "PRODUCT_LIMIT_REACHED" }, { status: 409 });
    }
    if (code === "IMPORT_STOCK_BELOW_RESERVED") {
      return NextResponse.json({ error: "Yeni stok miqdarı rezerv edilmiş stokdan az ola bilməz" }, { status: 409 });
    }
    console.error("catalog import chunk failed", {
      jobId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    await db.importJob.updateMany({
      where: { id: jobId, storeId: access.storeId, status: { in: ["QUEUED", "PROCESSING"] } },
      data: { status: "FAILED", lastError: "Hissəni emal etmək mümkün olmadı" },
    });
    return NextResponse.json({ error: "İdxal hissəsi uğursuz oldu; işi təhlükəsiz şəkildə yenidən başlada bilərsiniz" }, { status: 500 });
  }
}
