/**
 * ADMIN-IP-TEST-1: the "Saxtalaşdırma testi" on the admin "Müştəri IP başlıqları" card (components/admin-system-status.tsx).
 *
 * The browser calls the existing, admin-only, read-only GET /api/admin/system?card=client-ip again, this time with forged
 * CF-Connecting-IP and X-Real-IP headers set to 198.51.100.23 (TEST-NET-2, RFC 5737: documentation only, never a real
 * visitor). The endpoint answers with the masked IP the app would trust (`ipWithFlagOn`, computed with the trust flag on).
 * - "198.51.*.*" back: the forged headers reached the app unchanged, so a visitor can choose their own IP (spoofable).
 * - The admin's real masked IP back: something in front (Cloudflare / the proxy) replaced the headers (safe).
 * - No IP, an error or a refused request: not spoofable this way, but the result needs a look (unknown).
 * Pure; no server change, no new route.
 */

export const SPOOF_TEST_IP = "198.51.100.23";
export const SPOOF_TEST_MASK_PREFIX = "198.51.";
export const SPOOF_TEST_HEADERS: Readonly<Record<string, string>> = { "CF-Connecting-IP": SPOOF_TEST_IP, "X-Real-IP": SPOOF_TEST_IP };

/**
 * Request headers a browser's fetch() silently drops (Fetch Standard, "forbidden request-header", as of 2024-2026):
 * these names, plus every name starting with "proxy-" or "sec-". (X-HTTP-Method(-Override) / X-Method-Override are only
 * forbidden with a forbidden method value; not relevant here.) Used to show that the test headers are not in this list.
 */
export const FORBIDDEN_REQUEST_HEADER_NAMES = [
  "accept-charset", "accept-encoding", "access-control-request-headers", "access-control-request-method",
  "access-control-request-private-network", "connection", "content-length", "cookie", "cookie2", "date", "dnt", "expect",
  "host", "keep-alive", "origin", "referer", "set-cookie", "te", "trailer", "transfer-encoding", "upgrade", "via",
] as const;

export function isForbiddenRequestHeader(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return (FORBIDDEN_REQUEST_HEADER_NAMES as readonly string[]).includes(lower) || lower.startsWith("proxy-") || lower.startsWith("sec-");
}

export type SpoofTestKind = "spoofable" | "safe" | "unknown";
/** Why the result is "unknown": request refused/failed, no IP came back, or the admin's own network is 198.51.x.x. */
export type SpoofTestUnknownReason = "refused" | "no-ip" | "same-network";
export type SpoofTestOutcome = { kind: SpoofTestKind; returnedIp: string | null; httpStatus: number | null; reason?: SpoofTestUnknownReason };

/**
 * Decides the test result.
 * - `ok`: the request succeeded and the body had ok:true. `ipWithFlagOn`: the masked IP in that body.
 * - `baselineIp`: `ipWithFlagOn` from the card's normal (unforged) load. If the admin's real network is itself
 *   198.51.x.x, a "198.51." answer proves nothing, so the result is "unknown" instead of a false alarm.
 */
export function evaluateSpoofTest(input: { ok: boolean; httpStatus: number | null; ipWithFlagOn: string | null | undefined; baselineIp: string | null | undefined }): SpoofTestOutcome {
  const httpStatus = input.httpStatus;
  if (!input.ok) return { kind: "unknown", returnedIp: null, httpStatus, reason: "refused" };
  const returnedIp = typeof input.ipWithFlagOn === "string" && input.ipWithFlagOn.trim() ? input.ipWithFlagOn.trim() : null;
  if (!returnedIp) return { kind: "unknown", returnedIp: null, httpStatus, reason: "no-ip" };
  if (returnedIp.startsWith(SPOOF_TEST_MASK_PREFIX)) {
    const baseline = input.baselineIp?.trim() ?? "";
    return baseline.startsWith(SPOOF_TEST_MASK_PREFIX)
      ? { kind: "unknown", returnedIp, httpStatus, reason: "same-network" }
      : { kind: "spoofable", returnedIp, httpStatus };
  }
  return { kind: "safe", returnedIp, httpStatus };
}

/**
 * What the card shows for an outcome: red for spoofable; green for safe and for unknown "refused"/"no-ip" (as the owner
 * specified), the latter plus the neutral note; for "same-network" only the neutral note (green would be unproven).
 */
export function spoofTestDisplay(outcome: SpoofTestOutcome): { tone: "bad" | "good" | "neutral"; message: string | null; note: string | null } {
  if (outcome.kind === "spoofable") return { tone: "bad", message: SPOOF_TEST_TEXTS.spoofable, note: null };
  if (outcome.kind === "safe") return { tone: "good", message: SPOOF_TEST_TEXTS.safe, note: null };
  if (outcome.reason === "same-network") return { tone: "neutral", message: null, note: SPOOF_TEST_TEXTS.unknownNote };
  return { tone: "good", message: SPOOF_TEST_TEXTS.safe, note: SPOOF_TEST_TEXTS.unknownNote };
}

/** Visible texts (owner approval table in release-output/admin-ip-test-1-report.md). */
export const SPOOF_TEST_TEXTS = {
  button: "Saxtalaşdırma testi",
  busy: "Yoxlanılır…",
  intro: `Test saxta CF-Connecting-IP və X-Real-IP başlıqları ilə (${SPOOF_TEST_IP} — sənədlər üçün ayrılmış, real olmayan ünvan) eyni yoxlamanı təkrarlayır.`,
  spoofable: "IP saxtalaşdırıla bilər: başlıqlar yoxlanmadan keçir.",
  safe: "Saxtalaşdırma cəhdi uğursuz oldu: IP başlıqları kənardan dəyişdirilə bilmir.",
  unknownNote: "IP təyin olunmadı və ya sorğu rədd edildi; bu nəticəyə ayrıca baxmaq lazımdır.",
  returnedIp: "Qayıdan IP",
  none: "yoxdur",
  requestFailed: "Sorğu alınmadı.",
} as const;
