import { NextRequest, NextResponse } from "next/server";
import { requireStoreAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createImportJobPostHandler } from "@/lib/catalog-import-job-route";
import {
  assertFeature,
  getStoreEntitlements,
} from "@/lib/subscription-entitlements";

const db = prisma;

async function authorizedStore(storeId: string) {
  const access = await requireStoreAccess(storeId);
  return access?.user.role === "VENDOR" ? access : null;
}

export async function GET(_request: NextRequest, context: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await context.params;
  const access = await authorizedStore(storeId);
  if (!access) return NextResponse.json({ error: "Mağazaya giriş icazəsi yoxdur" }, { status: 403 });

  const jobs = await db.importJob.findMany({
    where: { storeId: access.storeId },
    select: {
      id: true,
      sourceName: true,
      sourceFormat: true,
      status: true,
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
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return NextResponse.json({ items: jobs });
}

export const POST = createImportJobPostHandler({
  authorizeStore: authorizedStore,
  assertBulkImportEnabled: async (storeId) => {
    const entitlement = await getStoreEntitlements(storeId, db);
    assertFeature(entitlement, "BULK_IMPORT");
  },
  createJob: ({ storeId, userId, data }) => db.importJob.create({
    data: {
      storeId,
      createdByUserId: userId,
      sourceName: data.sourceName,
      sourceFormat: data.sourceFormat,
      sourceSizeBytes: data.sourceSizeBytes,
      sourceChecksum: data.sourceChecksum,
      mode: data.mode,
      mapping: data.mapping,
      chunkSize: data.chunkSize,
    },
    select: { id: true, storeId: true, status: true, chunkSize: true, createdAt: true },
  }),
});
