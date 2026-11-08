import { NextResponse } from "next/server";

const headers = { "Cache-Control": "no-store" };

export type ReadinessStorage = "local" | "s3" | "unconfigured";

/** Database readiness, separate from process liveness at `/api/health`. */
export async function readinessResponse(probe: () => Promise<unknown>, storage: ReadinessStorage = "unconfigured") {
  try {
    await probe();
    return NextResponse.json({ status: "ready", storage }, { status: 200, headers });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers });
  }
}
