import { NextRequest, NextResponse } from "next/server";
import { acceptEpointCallback } from "@/lib/payments/epoint-checkout";
import { consumePaymentRateLimit, paymentClientKey } from "@/lib/payments/epoint-rate-limit";
import { readBoundedRequestBody } from "@/lib/request-body";

export const dynamic = "force-dynamic";
const MAX_CALLBACK_BODY_BYTES = 32 * 1024;
const CALLBACK_GLOBAL_RATE_LIMIT = { limit: 600, windowMs: 60_000 } as const;
const CALLBACK_CLIENT_RATE_LIMIT = { limit: 60, windowMs: 60_000 } as const;

export async function POST(request: NextRequest) {
  const clientKey = paymentClientKey(request.headers);
  const globalAllowed = consumePaymentRateLimit("callback:global", CALLBACK_GLOBAL_RATE_LIMIT.limit, CALLBACK_GLOBAL_RATE_LIMIT.windowMs);
  const clientAllowed = !clientKey || consumePaymentRateLimit(`callback:${clientKey}`, CALLBACK_CLIENT_RATE_LIMIT.limit, CALLBACK_CLIENT_RATE_LIMIT.windowMs);
  if (!globalAllowed || !clientAllowed) {
    return NextResponse.json({ code: "RATE_LIMITED" }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }
  let body: string;
  try {
    body = await readBoundedRequestBody(request, MAX_CALLBACK_BODY_BYTES);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "BODY_TOO_LARGE";
    return NextResponse.json(
      { code: tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_BODY" },
      { status: tooLarge ? 413 : 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const fields = new URLSearchParams(body);
  const data = fields.get("data") ?? "";
  const signature = fields.get("signature") ?? "";
  const result = await acceptEpointCallback(data, signature);
  return NextResponse.json({ code: result.code }, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
