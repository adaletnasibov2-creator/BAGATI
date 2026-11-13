import { NextResponse } from "next/server";
import { authRateLimitKey, consumeAuthProcessRateLimit, consumeAuthRateLimit } from "@/lib/auth-rate-limit";
import { csrfRejection } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { readBoundedRequestBody } from "@/lib/request-body";
import {
  hashInquiryIp,
  INQUIRY_IP_RATE_LIMIT,
  INQUIRY_LIMITS,
  INQUIRY_MESSAGES,
  INQUIRY_PROCESS_RATE_LIMIT,
  INQUIRY_STORE_RATE_LIMIT,
  inquiryIssueMessage,
  storeInquirySchema,
} from "@/lib/store-inquiry";
import { submitStoreInquiry } from "@/lib/store-inquiry-submit";
import { trustedCloudflareClientIp } from "@/lib/trusted-proxy";
import { loadInquiryLimits } from "@/lib/settings/limits";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const json = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status, headers: noStore });

/**
 * Public buyer-to-store message. Same-origin only, JSON only, small bodies, strict validation,
 * per-IP and per-store limits, honeypot. Responses never contain the store's email address.
 */
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  // Middleware already applies this to /api/*; repeated here so the route stays safe on its own.
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: INQUIRY_MESSAGES.invalid }, 415);
  }
  const { storeId } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(storeId)) return json({ error: INQUIRY_MESSAGES.storeUnavailable }, 404);

  let raw: unknown;
  try {
    raw = JSON.parse(await readBoundedRequestBody(request, INQUIRY_LIMITS.bodyBytes));
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "BODY_TOO_LARGE";
    return json({ error: tooLarge ? INQUIRY_MESSAGES.message : INQUIRY_MESSAGES.invalid }, tooLarge ? 413 : 400);
  }
  const parsed = storeInquirySchema.safeParse(raw);
  if (!parsed.success) return json({ error: inquiryIssueMessage(parsed.error) }, 422);
  // Honeypot filled: answer like a success so bots learn nothing, but store nothing.
  if (parsed.data.honeypotFilled) return json({ ok: true, message: INQUIRY_MESSAGES.sent }, 201);

  if (!consumeAuthProcessRateLimit("store-inquiry", INQUIRY_PROCESS_RATE_LIMIT.limit, INQUIRY_PROCESS_RATE_LIMIT.windowMs)) {
    return json({ error: INQUIRY_MESSAGES.rateLimited }, 429);
  }
  const clientIp = trustedCloudflareClientIp(request.headers);
  try {
    // Hourly numbers from the settings engine (limits.inquiry.*, defaults 5 per IP and 30 per store); windows stay in code.
    const limits = await loadInquiryLimits();
    const ipAllowed = !clientIp || await consumeAuthRateLimit(authRateLimitKey("store-inquiry", `ip:${clientIp}`), limits.perIpPerHour, INQUIRY_IP_RATE_LIMIT.windowMs);
    const storeAllowed = await consumeAuthRateLimit(authRateLimitKey("store-inquiry", `store:${storeId}`), limits.perStorePerHour, INQUIRY_STORE_RATE_LIMIT.windowMs);
    if (!ipAllowed || !storeAllowed) return json({ error: INQUIRY_MESSAGES.rateLimited }, 429);

    const result = await submitStoreInquiry(prisma, {
      storeId,
      data: parsed.data,
      ipHash: clientIp ? hashInquiryIp(clientIp) : null,
      appBaseUrl: process.env.APP_BASE_URL,
    });
    if (result.kind === "NOT_FOUND") return json({ error: INQUIRY_MESSAGES.storeUnavailable }, 404);
    return json({ ok: true, message: INQUIRY_MESSAGES.sent }, 201);
  } catch {
    console.error(JSON.stringify({ event: "store.inquiry.failed" }));
    return json({ error: INQUIRY_MESSAGES.unavailable }, 503);
  }
}
