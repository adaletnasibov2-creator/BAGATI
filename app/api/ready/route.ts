import { prisma } from "@/lib/prisma";
import { readinessResponse, referenceDataState } from "@/lib/readiness";
import { storageReadinessMode } from "@/lib/storage/store-assets";
import { googleOAuthConfigIssues } from "@/lib/google-oauth";

export const dynamic = "force-dynamic";

export function GET() {
  return readinessResponse(() => prisma.$queryRaw`SELECT 1`, storageReadinessMode(), async () => {
    const [activeCities, activeCategories] = await Promise.all([
      prisma.city.count({ where: { isActive: true } }),
      prisma.category.count({ where: { isActive: true } }),
    ]);
    return {
      googleSignIn: googleOAuthConfigIssues().length ? "unconfigured" : "configured",
      referenceData: referenceDataState({ activeCities, activeCategories }),
    };
  });
}
