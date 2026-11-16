/**
 * HTTP helpers shared by the customer (/api/account/messages/...) and seller (/api/vendor/[storeId]/messages/...)
 * messaging routes. Server-only.
 *
 * Order in every route: same-origin check (writes) -> role / store access (401/403) -> messaging switch (403 while OFF)
 * -> id format (404) -> body (4 KB cap) -> service. Anything that is not the caller's own is 404.
 */
import { NextResponse } from "next/server";
import { MESSAGE_LIMITS, MESSAGING_TEXT } from "@/lib/messaging";
import { MessagingError } from "@/lib/messaging-service";
import { loadMessagingSettings, type MessagingSettings } from "@/lib/messaging-settings";
import { readJsonBodyLimited } from "@/lib/request-json";

export const MESSAGING_DISABLED_CODE = "MESSAGING_DISABLED";
const noStore = { "Cache-Control": "no-store" } as const;

export function messagingJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

/** 204 for polling: nothing new since the given message. */
export function messagingNoContent() {
  return new NextResponse(null, { status: 204, headers: noStore });
}

export const messagingUnauthenticated = () => messagingJson({ error: "Daxil olmaq tələb olunur." }, 401);
export const messagingNotFound = () => messagingJson({ error: "Söhbət tapılmadı." }, 404);

/** Loads the cached settings; while messaging is OFF every route answers 403 with a clear message and a code. */
export async function messagingGate(load: () => Promise<MessagingSettings> = loadMessagingSettings): Promise<{ settings: MessagingSettings } | { response: NextResponse }> {
  const settings = await load();
  if (!settings.enabled) return { response: messagingJson({ error: MESSAGING_TEXT.disabled, code: MESSAGING_DISABLED_CODE }, 403) };
  return { settings };
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
export function isMessagingId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

/** JSON body, at most 4 KB (MESSAGE_LIMITS.bodyBytes). */
export async function readMessagingBody(request: Request): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return { ok: false, response: messagingJson({ error: "Sorğu məlumatı yanlışdır." }, 415) };
  }
  const result = await readJsonBodyLimited(request, MESSAGE_LIMITS.bodyBytes);
  if (!result.ok) {
    return { ok: false, response: messagingJson({ error: result.status === 413 ? "Mesaj çox uzundur." : "Sorğu məlumatı yanlışdır." }, result.status) };
  }
  if (!result.value || typeof result.value !== "object" || Array.isArray(result.value)) {
    return { ok: false, response: messagingJson({ error: "Sorğu məlumatı yanlışdır." }, 400) };
  }
  return { ok: true, value: result.value as Record<string, unknown> };
}

const STATUS: Record<MessagingError["code"], number> = {
  DISABLED: 403,
  NOT_FOUND: 404,
  CONTEXT_INVALID: 404,
  STORE_UNAVAILABLE: 409,
  BLOCKED: 403,
  RATE_LIMITED: 429,
  INVALID_BODY: 422,
  INVALID: 422,
};

/** Service errors to responses; anything unexpected is logged without request data and answered with 503. */
export function messagingErrorResponse(error: unknown, event: string) {
  if (error instanceof MessagingError) {
    const status = STATUS[error.code];
    const message = status === 404 ? "Söhbət tapılmadı." : error.userMessage;
    return messagingJson({ error: message, code: error.code }, status);
  }
  console.error(JSON.stringify({ event: `messaging.${event}.failed` }));
  return messagingJson({ error: "Mesajlaşma müvəqqəti əlçatan deyil. Bir az sonra yenidən cəhd edin." }, 503);
}
