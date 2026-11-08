import { prisma } from "@/lib/prisma";
import { readinessResponse } from "@/lib/readiness";
import { storageReadinessMode } from "@/lib/storage/store-assets";

export const dynamic = "force-dynamic";

export function GET() {
  return readinessResponse(() => prisma.$queryRaw`SELECT 1`, storageReadinessMode());
}
