import { NextResponse } from "next/server";

const headers = { "Cache-Control": "no-store" };

export type ReadinessStorage = "local" | "s3" | "unconfigured";
/** Coarse, value-free operator signals. They never include names, counts of users, URLs or secrets. */
export type ReadinessDetails = {
  googleSignIn?: "configured" | "unconfigured";
  /** "missing" means no active city or no active category exists, so the storefront renders empty menus. */
  referenceData?: "present" | "missing";
};

/** Database readiness, separate from process liveness at `/api/health`. */
export async function readinessResponse(
  probe: () => Promise<unknown>,
  storage: ReadinessStorage = "unconfigured",
  details?: () => Promise<ReadinessDetails>,
) {
  try {
    await probe();
    let extra: ReadinessDetails = {};
    if (details) {
      try { extra = await details(); } catch { /* Optional signals never change database readiness. */ }
    }
    return NextResponse.json({ status: "ready", storage, ...extra }, { status: 200, headers });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers });
  }
}

export function referenceDataState(counts: { activeCities: number; activeCategories: number }): "present" | "missing" {
  return counts.activeCities > 0 && counts.activeCategories > 0 ? "present" : "missing";
}
