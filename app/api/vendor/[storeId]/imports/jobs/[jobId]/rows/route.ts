import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireStoreAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readJsonBodyLimited } from "@/lib/request-json";
import {
  MAX_IMPORT_ROW_BYTES,
  MAX_IMPORT_ROWS_PER_UPLOAD,
  normalizeImportSku,
  planImportRowAppend,
} from "@/lib/catalog-import-jobs";
import { sameJsonValue } from "@/lib/sku-normalization";

const db = prisma;
const MAX_STAGING_REQUEST_BYTES = 512 * 1024;
const uploadRowsSchema = z.object({
  rows: z.array(z.object({
    rowNumber: z.number().int().positive(),
    data: z.record(z.unknown()),
  })).min(1).max(MAX_IMPORT_ROWS_PER_UPLOAD),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ storeId: string; jobId: string }> },
) {
  const { storeId, jobId } = await context.params;
  const access = await requireStoreAccess(storeId);
  if (!access || access.user.role !== "VENDOR") {
    return NextResponse.json({ error: "Mağazaya giriş icazəsi yoxdur" }, { status: 403 });
  }

  const body = await readJsonBodyLimited(request, MAX_STAGING_REQUEST_BYTES);
  if (!body.ok) {
    return NextResponse.json(
      {
        error: body.error === "BODY_TOO_LARGE" ? "Sorğu icazə verilən ölçüdən böyükdür" : "İdxal sətirləri yanlışdır",
        code: body.error,
      },
      { status: body.status },
    );
  }
  const parsed = uploadRowsSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "Maksimum 50 sətirlik ardıcıl hissə göndərin", details: parsed.error.flatten() }, { status: 422 });
  }
  const rowNumbers = parsed.data.rows.map((row) => row.rowNumber);
  if (new Set(rowNumbers).size !== rowNumbers.length) {
    return NextResponse.json({ error: "Hissədə eyni sətir nömrəsi təkrarlanıb" }, { status: 422 });
  }
  if (rowNumbers.some((rowNumber, index) => index > 0 && rowNumber !== rowNumbers[index - 1] + 1)) {
    return NextResponse.json({ error: "Hissədə sətirlər artan ardıcıllıqla göndərilməlidir" }, { status: 422 });
  }
  for (const row of parsed.data.rows) {
    if (Buffer.byteLength(JSON.stringify(row.data), "utf8") > MAX_IMPORT_ROW_BYTES) {
      return NextResponse.json({ error: `Sətir ${row.rowNumber} icazə verilən ölçüdən böyükdür` }, { status: 413 });
    }
  }

  try {
    const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT "id" FROM "ImportJob" WHERE "id" = ${jobId} AND "storeId" = ${access.storeId} FOR UPDATE`;
      const job = await tx.importJob.findFirst({ where: { id: jobId, storeId: access.storeId } });
      if (!job) return { error: "NOT_FOUND" as const };
      if (job.status !== "UPLOADING") return { error: "NOT_UPLOADING" as const };
      if (parsed.data.rows.length > job.chunkSize) return { error: "CHUNK_TOO_LARGE" as const };

      let appendPlan: ReturnType<typeof planImportRowAppend>;
      try {
        appendPlan = planImportRowAppend({ currentTotal: job.totalRows, rowNumbers });
      } catch (error) {
        return { error: error instanceof Error ? error.message : "INVALID_IMPORT_ROW_RANGE" };
      }

      const existing = await tx.importJobRow.findMany({
        where: { jobId, rowNumber: { in: rowNumbers } },
        select: { rowNumber: true, sourceData: true },
      });
      const existingByNumber = new Map(existing.map((row: { rowNumber: number; sourceData: unknown }) => [row.rowNumber, row.sourceData]));
      if (parsed.data.rows.some((row) =>
        existingByNumber.has(row.rowNumber) && !sameJsonValue(existingByNumber.get(row.rowNumber), row.data)
      )) return { error: "ROW_REPLAY_CONFLICT" as const };
      const existingRows = new Set(existingByNumber.keys());
      const newRows = parsed.data.rows.filter((row) => !existingRows.has(row.rowNumber));
      const mapping = job.mapping as Record<string, string>;
      const skuColumn = typeof mapping.sku === "string" ? mapping.sku : null;
      const rowData = newRows.map((row) => ({
        id: crypto.randomUUID(),
        jobId,
        rowNumber: row.rowNumber,
        sourceData: row.data as Prisma.InputJsonValue,
        normalizedSku: skuColumn ? normalizeImportSku(row.data[skuColumn]) : null,
      }));
      if (rowData.length) await tx.importJobRow.createMany({ data: rowData });

      if (skuColumn) {
        const firstBySku = new Map<string, number>();
        for (const row of newRows) {
          const sku = normalizeImportSku(row.data[skuColumn]);
          if (sku && !firstBySku.has(sku)) firstBySku.set(sku, row.rowNumber);
        }
        if (firstBySku.size) {
          await tx.importJobSku.createMany({
            data: [...firstBySku].map(([normalizedSku, firstRowNumber]) => ({
              id: crypto.randomUUID(),
              jobId,
              normalizedSku,
              firstRowNumber,
            })),
            skipDuplicates: true,
          });
        }
      }

      await tx.importJob.update({
        where: { id: jobId },
        data: { totalRows: appendPlan.nextTotal },
      });
      return { totalRows: appendPlan.nextTotal, acceptedRows: newRows.length };
    });

    if (result.error === "NOT_FOUND") return NextResponse.json({ error: "İdxal işi tapılmadı" }, { status: 404 });
    if (result.error === "NOT_UPLOADING") return NextResponse.json({ error: "Bu idxal işi artıq sətir qəbul etmir" }, { status: 409 });
    if (result.error === "CHUNK_TOO_LARGE") return NextResponse.json({ error: "Göndərilən hissə işin hissə limitindən böyükdür" }, { status: 413 });
    if (result.error === "ROW_REPLAY_CONFLICT") return NextResponse.json({ error: "Eyni sətir nömrəsi fərqli məlumatla göndərilib" }, { status: 409 });
    if (result.error) return NextResponse.json({ error: "Sətir ardıcıllığı yanlışdır", code: result.error }, { status: 409 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("catalog import row staging failed", {
      jobId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "İdxal sətirləri saxlanılmadı" }, { status: 500 });
  }
}
