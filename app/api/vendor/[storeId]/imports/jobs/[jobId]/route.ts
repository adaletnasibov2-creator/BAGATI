import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireStoreAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessImportJob, MAX_IMPORT_ROW_BYTES, normalizeImportSku } from "@/lib/catalog-import-jobs";
import { readJsonBodyLimited } from "@/lib/request-json";

const db = prisma;
const MAX_RETRY_REQUEST_BYTES = 1024 * 1024;
const pageSchema = z.object({
  after: z.coerce.number().int().positive().optional(),
  take: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ storeId: string; jobId: string }> },
) {
  const { storeId, jobId } = await context.params;
  const access = await requireStoreAccess(storeId);
  if (!access || access.user.role !== "VENDOR") {
    return NextResponse.json({ error: "Mağazaya giriş icazəsi yoxdur" }, { status: 403 });
  }
  const job = await db.importJob.findFirst({
    where: { id: jobId, storeId: access.storeId },
    select: {
      id: true,
      storeId: true,
      status: true,
      sourceName: true,
      sourceFormat: true,
      mode: true,
      chunkSize: true,
      totalRows: true,
      processedRows: true,
      createdRows: true,
      updatedRows: true,
      skippedRows: true,
      failedRows: true,
      retryCount: true,
      lastError: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
    },
  });
  if (!job || !canAccessImportJob({ role: access.user.role, storeId: access.storeId, jobStoreId: job.storeId })) {
    return NextResponse.json({ error: "İdxal işi tapılmadı" }, { status: 404 });
  }

  const parsedPage = pageSchema.safeParse({
    after: request.nextUrl.searchParams.get("after") ?? undefined,
    take: request.nextUrl.searchParams.get("take") ?? undefined,
  });
  if (!parsedPage.success) return NextResponse.json({ error: "Sətir səhifəsi yanlışdır" }, { status: 400 });
  const rows = await db.importJobRow.findMany({
    where: { jobId, ...(parsedPage.data.after ? { rowNumber: { gt: parsedPage.data.after } } : {}) },
    select: { rowNumber: true, status: true, errors: true, warnings: true, productId: true, retryCount: true },
    orderBy: { rowNumber: "asc" },
    take: parsedPage.data.take,
  });
  return NextResponse.json({ job, rows, nextAfter: rows.length ? rows[rows.length - 1].rowNumber : null });
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("finalize") }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("cancel") }),
  z.object({
    action: z.literal("retry_failed"),
    replacements: z.array(z.object({ rowNumber: z.number().int().positive(), data: z.record(z.unknown()) })).max(100).default([]),
  }),
]);

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ storeId: string; jobId: string }> },
) {
  const { storeId, jobId } = await context.params;
  const access = await requireStoreAccess(storeId);
  if (!access || access.user.role !== "VENDOR") {
    return NextResponse.json({ error: "Mağazaya giriş icazəsi yoxdur" }, { status: 403 });
  }
  const body = await readJsonBodyLimited(request, MAX_RETRY_REQUEST_BYTES);
  if (!body.ok) {
    return NextResponse.json(
      {
        error: body.error === "BODY_TOO_LARGE" ? "Sorğu icazə verilən ölçüdən böyükdür" : "İdxal işi əməliyyatı yanlışdır",
        code: body.error,
      },
      { status: body.status },
    );
  }
  const parsed = actionSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: "İdxal işi əməliyyatını yoxlayın" }, { status: 422 });

  const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT "id" FROM "ImportJob" WHERE "id" = ${jobId} AND "storeId" = ${access.storeId} FOR UPDATE`;
    const job = await tx.importJob.findFirst({ where: { id: jobId, storeId: access.storeId } });
    if (!job || !canAccessImportJob({ role: access.user.role, storeId: access.storeId, jobStoreId: job.storeId })) {
      return { error: "NOT_FOUND" as const };
    }

    switch (parsed.data.action) {
      case "finalize":
        if (job.status !== "UPLOADING" || job.totalRows < 1) return { error: "INVALID_STATE" as const };
        return { job: await tx.importJob.update({ where: { id: jobId }, data: { status: "QUEUED" } }) };
      case "pause":
        if (job.status !== "QUEUED" && job.status !== "PROCESSING") return { error: "INVALID_STATE" as const };
        return { job: await tx.importJob.update({ where: { id: jobId }, data: { status: "PAUSED" } }) };
      case "resume":
        if (job.status !== "PAUSED" && job.status !== "FAILED") return { error: "INVALID_STATE" as const };
        return { job: await tx.importJob.update({ where: { id: jobId }, data: { status: "QUEUED", lastError: null, completedAt: null } }) };
      case "cancel":
        if (job.status === "COMPLETED" || job.status === "COMPLETED_WITH_ERRORS" || job.status === "CANCELLED") {
          return { error: "INVALID_STATE" as const };
        }
        return { job: await tx.importJob.update({ where: { id: jobId }, data: { status: "CANCELLED", completedAt: new Date() } }) };
      case "retry_failed": {
        if (job.status !== "COMPLETED_WITH_ERRORS" && job.status !== "FAILED") return { error: "INVALID_STATE" as const };
        const rowNumbers = parsed.data.replacements.map((replacement) => replacement.rowNumber);
        if (new Set(rowNumbers).size !== rowNumbers.length) return { error: "DUPLICATE_REPLACEMENT" as const };
        const failedRows = rowNumbers.length
          ? await tx.importJobRow.findMany({
            where: { jobId, rowNumber: { in: rowNumbers }, status: "FAILED" },
            select: { rowNumber: true, normalizedSku: true },
          })
          : [];
        if (failedRows.length !== rowNumbers.length) return { error: "ROW_NOT_RETRYABLE" as const };
        const mapping = job.mapping as Record<string, string>;
        const skuColumn = typeof mapping.sku === "string" ? mapping.sku : null;
        const replacementSkus = parsed.data.replacements.map((replacement) => ({
          rowNumber: replacement.rowNumber,
          normalizedSku: skuColumn ? normalizeImportSku(replacement.data[skuColumn]) : null,
        }));
        const replacementSkuRows = new Set<string>();
        for (const replacement of replacementSkus) {
          if (!replacement.normalizedSku) continue;
          if (replacementSkuRows.has(replacement.normalizedSku)) return { error: "DUPLICATE_REPLACEMENT_SKU" as const };
          replacementSkuRows.add(replacement.normalizedSku);
        }
        const replacementSkuKeys = [...replacementSkuRows];
        if (replacementSkuKeys.length) {
          const conflictingRow = await tx.importJobRow.findFirst({
            where: {
              jobId,
              normalizedSku: { in: replacementSkuKeys },
              rowNumber: { notIn: rowNumbers },
            },
            select: { rowNumber: true },
          });
          if (conflictingRow) return { error: "DUPLICATE_REPLACEMENT_SKU" as const };
        }
        for (const replacement of parsed.data.replacements) {
          if (Buffer.byteLength(JSON.stringify(replacement.data), "utf8") > MAX_IMPORT_ROW_BYTES) return { error: "ROW_TOO_LARGE" as const };
        }
        const affectedSkus = [...new Set([
          ...failedRows.flatMap((row) => row.normalizedSku ? [row.normalizedSku] : []),
          ...replacementSkus.flatMap((row) => row.normalizedSku ? [row.normalizedSku] : []),
        ])];
        const replacementSkuByRow = new Map(replacementSkus.map((row) => [row.rowNumber, row.normalizedSku]));
        for (const replacement of parsed.data.replacements) {
          const normalizedSku = replacementSkuByRow.get(replacement.rowNumber) ?? null;
          await tx.importJobRow.updateMany({
            where: { jobId, rowNumber: replacement.rowNumber, status: "FAILED" },
            data: {
              sourceData: replacement.data as Prisma.InputJsonValue,
              normalizedSku,
              status: "PENDING",
              errors: Prisma.DbNull,
              warnings: Prisma.DbNull,
              processedAt: null,
              retryCount: { increment: 1 },
            },
          });
        }
        const reset = await tx.importJobRow.updateMany({
          where: { jobId, status: "FAILED", ...(rowNumbers.length ? { rowNumber: { notIn: rowNumbers } } : {}) },
          data: { status: "PENDING", errors: Prisma.DbNull, processedAt: null, retryCount: { increment: 1 } },
        });
        if (affectedSkus.length) {
          const firstRows = await tx.importJobRow.groupBy({
            by: ["normalizedSku"],
            where: { jobId, normalizedSku: { in: affectedSkus } },
            _min: { rowNumber: true },
          });
          const firstBySku = new Map(firstRows.flatMap((row) =>
            row.normalizedSku && row._min.rowNumber !== null
              ? [[row.normalizedSku, row._min.rowNumber] as const]
              : []
          ));
          const removedSkus = affectedSkus.filter((sku) => !firstBySku.has(sku));
          if (removedSkus.length) {
            await tx.importJobSku.deleteMany({ where: { jobId, normalizedSku: { in: removedSkus } } });
          }
          const retainedSkus = [...firstBySku];
          if (retainedSkus.length) {
            const values = retainedSkus.map(([normalizedSku, firstRowNumber]) => Prisma.sql`(
              ${crypto.randomUUID()}::text,
              ${jobId}::text,
              ${normalizedSku}::text,
              ${firstRowNumber}::integer
            )`);
            await tx.$executeRaw(Prisma.sql`
              INSERT INTO "ImportJobSku" ("id", "jobId", "normalizedSku", "firstRowNumber")
              VALUES ${Prisma.join(values)}
              ON CONFLICT ("jobId", "normalizedSku")
              DO UPDATE SET "firstRowNumber" = EXCLUDED."firstRowNumber"
            `);
          }
        }
        const retryCount = reset.count + rowNumbers.length;
        if (!retryCount) return { error: "NO_FAILED_ROWS" as const };
        return {
          job: await tx.importJob.update({
            where: { id: jobId },
            data: {
              status: "QUEUED",
              processedRows: { decrement: retryCount },
              failedRows: { decrement: retryCount },
              retryCount: { increment: 1 },
              lastError: null,
              completedAt: null,
            },
          }),
        };
      }
    }
  });
  if (result.error === "NOT_FOUND") return NextResponse.json({ error: "İdxal işi tapılmadı" }, { status: 404 });
  if (result.error === "DUPLICATE_REPLACEMENT_SKU") return NextResponse.json({ error: "Düzəldilmiş sətirlərdə məhsul kodu təkrarlanır" }, { status: 409 });
  if (result.error) return NextResponse.json({ error: "Bu statusda əməliyyatı yerinə yetirmək mümkün deyil", code: result.error }, { status: 409 });
  return NextResponse.json({ job: result.job });
}
