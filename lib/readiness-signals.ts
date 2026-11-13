import type { PrismaClient } from "@prisma/client";
import { referenceDataState, type ReadinessDetails } from "@/lib/readiness";
import { googleOAuthConfigIssues } from "@/lib/google-oauth";

type ReferenceDataReader = Pick<PrismaClient, "city" | "category">;

/** Value-free readiness signals shared by `/api/ready` and the admin system status page. */
export async function collectReadinessDetails(db: ReferenceDataReader): Promise<Required<ReadinessDetails>> {
  const [activeCities, activeCategories] = await Promise.all([
    db.city.count({ where: { isActive: true } }),
    db.category.count({ where: { isActive: true } }),
  ]);
  return {
    googleSignIn: googleOAuthConfigIssues().length ? "unconfigured" : "configured",
    referenceData: referenceDataState({ activeCities, activeCategories }),
  };
}
