import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBodyLimited } from "@/lib/request-json";
import {
  DEFAULT_IMPORT_JOB_CHUNK_SIZE,
  normalizeImportJobChunkSize,
} from "@/lib/catalog-import-jobs";
import {
  EntitlementError,
  entitlementErrorResponse,
} from "@/lib/subscription-entitlements";

export const MAX_IMPORT_JOB_CREATE_REQUEST_BYTES = 16 * 1024;
const createJobSchema = z.object({
  sourceName: z.string().trim().min(1).max(255),
  sourceFormat: z.enum(["csv", "tsv", "json", "xml", "xlsx"]),
  sourceSizeBytes: z.number().int().positive().max(100 * 1024 * 1024).optional(),
  sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  mode: z.enum(["create", "update", "mixed", "skip"]).default("create"),
  mapping: z.record(z.string().trim().min(1).max(128))
    .refine((mapping) => Object.keys(mapping).length <= 50)
    .refine((mapping) => Boolean(mapping.name && mapping.price && mapping.category)),
  chunkSize: z.number().int().optional(),
});
type CreateJobInput = z.infer<typeof createJobSchema>;

type CreateJobAccess = { storeId: string; user: { id: string; role: string } };
type CreateJobHandlerDependencies = {
  authorizeStore: (storeId: string) => Promise<CreateJobAccess | null>;
  assertBulkImportEnabled: (storeId: string) => Promise<void>;
  createJob: (input: { storeId: string; userId: string; data: CreateJobInput }) => Promise<unknown>;
};

export function createImportJobPostHandler(dependencies: CreateJobHandlerDependencies) {
  return async function POST(request: Request, context: { params: Promise<{ storeId: string }> }) {
    const { storeId } = await context.params;
    const access = await dependencies.authorizeStore(storeId);
    if (!access || access.user.role !== "VENDOR") {
      return NextResponse.json({ error: "Mağazaya giriş icazəsi yoxdur" }, { status: 403 });
    }

    try {
      await dependencies.assertBulkImportEnabled(access.storeId);
    } catch (error) {
      if (error instanceof EntitlementError) return entitlementErrorResponse(error);
      throw error;
    }

    const body = await readJsonBodyLimited(request, MAX_IMPORT_JOB_CREATE_REQUEST_BYTES);
    if (!body.ok) {
      return NextResponse.json(
        {
          error: body.error === "BODY_TOO_LARGE" ? "Sorğu icazə verilən ölçüdən böyükdür" : "İdxal işi məlumatı yanlışdır",
          code: body.error,
        },
        { status: body.status },
      );
    }
    const parsed = createJobSchema.safeParse(body.value);
    if (!parsed.success) {
      return NextResponse.json({ error: "İdxal işi məlumatlarını yoxlayın", details: parsed.error.flatten() }, { status: 422 });
    }

    let chunkSize = DEFAULT_IMPORT_JOB_CHUNK_SIZE;
    try {
      chunkSize = normalizeImportJobChunkSize(parsed.data.chunkSize);
    } catch {
      return NextResponse.json({ error: "İdxal hissəsinin ölçüsü 10–50 aralığında olmalıdır" }, { status: 422 });
    }

    const job = await dependencies.createJob({
      storeId: access.storeId,
      userId: access.user.id,
      data: { ...parsed.data, chunkSize },
    });
    return NextResponse.json({ job }, { status: 201 });
  };
}
