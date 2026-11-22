/**
 * Pure helpers for the admin security summary (/admin/security-center) and the "Ətraflı hadisələr" list (SECURITY-PAGE-1).
 * No database or request access; unit-tested.
 */
import { maskIpAddress } from "@/lib/admin-system-status";
import type { ClientIpDiagnostics } from "@/lib/client-ip-diagnostics";

/** Login endpoints whose failures are stored as LOGIN_FAILURE events, with the labels the old panel already used. */
const PORTAL_BY_PATH: Readonly<Record<string, string>> = {
  "/api/auth/login": "Müştəri girişi",
  "/api/auth/vendor-login": "Satıcı girişi",
  "/api/admin/login": "Admin girişi",
  "/api/admin/login/2fa": "Admin 2FA",
  "/api/admin/2fa/disable": "Admin 2FA",
  "/api/admin/2fa/setup": "Admin 2FA",
  "/api/admin/2fa/activate": "Admin 2FA",
};

export function portalForPath(path: string | null | undefined): string {
  if (!path) return "—";
  return PORTAL_BY_PATH[path] ?? path;
}

/** ADMIN_LOGIN_FAILED metadata.portal -> label. */
export function portalLabel(portal: unknown): string {
  return portal === "admin" ? "Admin girişi" : portal === "customer" ? "Müştəri girişi" : portal === "vendor" ? "Satıcı girişi" : "—";
}

export function loginMethodLabel(method: unknown): string {
  return method === "2fa" ? "Şifrə + 2FA kodu" : method === "2fa-enroll" ? "Şifrə + 2FA qoşulması" : method === "password" ? "Yalnız şifrə" : "—";
}

/** 404 probe groups counted by the app's telemetry (labels as in the old panel). */
export const NOT_FOUND_GROUPS: ReadonlyArray<{ group: string; label: string }> = [
  { group: "notfound.php", label: "404 · PHP skanı" },
  { group: "notfound.wp", label: "404 · WordPress skanı" },
  { group: "notfound.secrets", label: "404 · gizli fayl axtarışı" },
  { group: "notfound.admin-probe", label: "404 · admin panel axtarışı" },
  { group: "notfound.api", label: "404 · API" },
  { group: "notfound.other", label: "404 · digər" },
];

/** Event types the app itself records (lib/security-events.ts); the other schema types have no producer. */
export const EVENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  LOGIN_FAILURE: "Uğursuz giriş",
  RATE_LIMIT_VIOLATION: "Limit aşımı",
  IP_HEADER_MISMATCH: "IP başlıqları uyğun gəlmir",
};
export const PRODUCED_EVENT_TYPES = Object.keys(EVENT_TYPE_LABELS) as Array<keyof typeof EVENT_TYPE_LABELS>;

export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? type;
}

export const SEVERITY_LABELS: Readonly<Record<string, string>> = { LOW: "Aşağı", MEDIUM: "Orta", HIGH: "Yüksək", CRITICAL: "Kritik" };
export const INCIDENT_STATUS_LABELS: Readonly<Record<string, string>> = { OPEN: "Açıq", ACKNOWLEDGED: "Qəbul edilib", RESOLVED: "Həll edilib", FALSE_POSITIVE: "Yanlış həyəcan" };

/**
 * The IP shown for one stored value. `full` = the admin opened full IPs (an AuditLog row was written first).
 * A raw IP exists for 30 days (lib/security-monitoring/jobs.ts RETENTION); after that only the mask is left.
 */
export function shownIp(raw: string | null | undefined, masked: string | null | undefined, full: boolean): string | null {
  if (full && raw) return raw;
  if (masked) return masked;
  return raw ? maskIpAddress(raw) : null;
}

/** ADMIN_LOGIN audit rows -> full IP and method per session (key: userId + session reference). */
export function loginAuditBySession(rows: ReadonlyArray<{ actorId: string | null; entityId: string | null; metadata: unknown }>): Map<string, { ip: string | null; method: unknown }> {
  const map = new Map<string, { ip: string | null; method: unknown }>();
  for (const row of rows) {
    if (!row.actorId || !row.entityId) continue;
    const meta = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
    map.set(`${row.actorId}:${row.entityId}`, { ip: typeof meta.ip === "string" ? meta.ip : null, method: meta.method });
  }
  return map;
}

export type IpCheckTone = "good" | "warn" | "bad";

/**
 * The "IP yoxlaması" light from the admin's own request (the same data as the Sistem vəziyyəti card).
 * good: a trusted client IP is used and both proxy headers agree; warn: it works but X-Real-IP is missing (cannot rule
 * out spoofing: run the spoof test), or the trust flag is off; bad: the flag is on but no IP can be trusted.
 */
export function ipCheckLight(data: Pick<ClientIpDiagnostics, "flagEnabled" | "headers" | "ipWithFlagOn" | "cfRealIpMismatch">): { tone: IpCheckTone; title: string; detail: string } {
  const realIpPresent = data.headers.some((header) => header.name === "x-real-ip" && header.present);
  if (!data.flagEnabled) return { tone: "warn", title: "IP tanınmır", detail: "BAGATI_TRUST_CLOUDFLARE_IP aktiv deyil; IP-yə görə limitlər ümumi limitə keçir." };
  if (!data.ipWithFlagOn || data.cfRealIpMismatch) return { tone: "bad", title: "IP tanınmır", detail: "Proksi başlıqları uyğun gəlmir və ya yoxdur; ziyarətçi IP-si etibarlı deyil." };
  if (!realIpPresent) return { tone: "warn", title: "IP tanınır, amma yoxlanmır", detail: "X-Real-IP başlığı gəlmir; saxtalaşdırma testini edin." };
  return { tone: "good", title: "IP düzgün tanınır", detail: `Sizin IP: ${data.ipWithFlagOn}` };
}

/** "Ətraflı hadisələr" filters from the query string (unknown values are ignored). */
export const EVENT_WINDOWS = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 } as const;
export type EventWindow = keyof typeof EVENT_WINDOWS;
export const EVENTS_PAGE_SIZE = 50;

export function parseEventFilters(params: Record<string, string | string[] | undefined>) {
  const one = (key: string) => { const value = params[key]; return (Array.isArray(value) ? value[0] : value)?.trim() ?? ""; };
  const window = (one("window") in EVENT_WINDOWS ? one("window") : "7d") as EventWindow;
  const eventType = (PRODUCED_EVENT_TYPES as string[]).includes(one("type")) ? one("type") : "";
  const severity = one("severity") in SEVERITY_LABELS ? one("severity") : "";
  const q = one("q").slice(0, 100);
  const pageNumber = Number(one("page") || "1");
  const page = Number.isSafeInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 1000 ? pageNumber : 1;
  return { window, eventType, severity, q, page, fullIp: one("ip") === "full" };
}
