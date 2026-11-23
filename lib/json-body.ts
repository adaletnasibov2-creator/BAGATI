import { NextResponse } from "next/server";
import { readJsonBodyLimited } from "@/lib/request-json";

/**
 * SEC-FIX-2 (L6): size caps for JSON request bodies. Each route's cap comes from its own schema's worst case (see
 * release-output/sec-fix-2-report.md); never below what the UI can send.
 */
export const JSON_BODY_LIMITS = {
  /** Short forms: login-type, ids, statuses, addresses, cart, notes. */
  small: 16 * 1024,
  /** Long texts (≤ 5000 chars) or id lists (orders ≤ 500 prices, promotions ≤ 1000 ids). */
  medium: 64 * 1024,
  /** Admin product edit (description, 12 image URLs, variants). */
  large: 256 * 1024,
  /** Seller product JSON: ≤ 100 variants × 12 image URLs × 500 chars + free-form options (~650 KB worst case). */
  product: 1024 * 1024,
  /** Legacy seller import: every parsed row of a ≤ 10 MB file in one body (keys repeat per row, JSON escaping). */
  legacyImport: 24 * 1024 * 1024,
} as const;

/** Existing text (vendor import job routes). */
export const BODY_TOO_LARGE_MESSAGE = "Sorğu icazə verilən ölçüdən böyükdür";

export class JsonBodyTooLargeError extends Error {
  constructor() {
    super("BODY_TOO_LARGE");
    this.name = "JsonBodyTooLargeError";
  }
}

/**
 * Like `request.json()` but reads at most `maxBytes` (Content-Length checked first, then the streamed bytes).
 * Over the cap: throws JsonBodyTooLargeError. Bad JSON / UTF-8 / length: throws SyntaxError, as `request.json()` did,
 * so each route keeps its own 400 answer.
 */
export async function readJsonCapped(request: Request, maxBytes: number): Promise<unknown> {
  const result = await readJsonBodyLimited(request, maxBytes);
  if (result.ok) return result.value;
  if (result.status === 413) throw new JsonBodyTooLargeError();
  throw new SyntaxError(result.error);
}

/** 413 for a JsonBodyTooLargeError, otherwise null: `catch (error) { return bodyTooLargeResponse(error) ?? <400> }`. */
export function bodyTooLargeResponse(error: unknown): NextResponse | null {
  if (!(error instanceof JsonBodyTooLargeError)) return null;
  return NextResponse.json({ error: BODY_TOO_LARGE_MESSAGE, code: "BODY_TOO_LARGE" }, { status: 413, headers: { "Cache-Control": "no-store" } });
}
