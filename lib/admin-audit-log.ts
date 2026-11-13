/**
 * Pure rules for the admin audit log filters and CSV export. No database access, so they are unit-tested.
 * Queries live in `admin-audit-log-query.ts`.
 */
import { escapeAdminReportCsvCell } from "@/lib/admin-report-csv";

export const AUDIT_LOG_PAGE_SIZE = 25;
export const AUDIT_EXPORT_MAX_ROWS = 10_000;
export const AUDIT_SUMMARY_MAX_LENGTH = 1_000;
export const AUDIT_EXPORT_ACTION = "AUDIT_EXPORT";

const BAKU_OFFSET_MS = 4 * 60 * 60_000; // Asia/Baku: UTC+4, no daylight saving time.
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;
const ACTOR_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export type AuditActorFilter = { kind: "system" } | { kind: "id"; value: string } | { kind: "email"; value: string };

export type AuditLogFilters = {
  actor?: AuditActorFilter;
  action?: string;
  entityType?: string;
  entityId?: string;
  /** YYYY-MM-DD, interpreted as a Baku calendar day. */
  from?: string;
  to?: string;
  q?: string;
};

export type ParsedAuditLogFilters = { filters: AuditLogFilters; errors: string[] };

/** Inclusive Baku calendar day as a half-open UTC interval [start, endExclusive). */
export function bakuDayBounds(value: string): { start: Date; endExclusive: Date } | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utcMidnight = Date.UTC(year, month - 1, day);
  const check = new Date(utcMidnight);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const start = new Date(utcMidnight - BAKU_OFFSET_MS);
  return { start, endExclusive: new Date(start.getTime() + 86_400_000) };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Parses URL search params into validated filters. Invalid values are dropped and reported, never passed to SQL. */
export function parseAuditLogFilters(params: Record<string, string | undefined>): ParsedAuditLogFilters {
  const filters: AuditLogFilters = {};
  const errors: string[] = [];

  const actor = text(params.actor);
  if (actor) {
    if (actor.toLowerCase() === "system") filters.actor = { kind: "system" };
    else if (actor.includes("@") && actor.length <= 254 && EMAIL_PATTERN.test(actor)) filters.actor = { kind: "email", value: actor.toLowerCase() };
    else if (ACTOR_ID_PATTERN.test(actor)) filters.actor = { kind: "id", value: actor };
    else errors.push("İcraçı: e-poçt, istifadəçi ID-si və ya “system” daxil edin.");
  }

  const action = text(params.action);
  if (action) {
    if (TOKEN_PATTERN.test(action)) filters.action = action;
    else errors.push("Əməl dəyəri yanlışdır.");
  }

  const entityType = text(params.entityType);
  if (entityType) {
    if (TOKEN_PATTERN.test(entityType)) filters.entityType = entityType;
    else errors.push("Obyekt növü yanlışdır.");
  }

  const entityId = text(params.entityId);
  if (entityId) {
    if (entityId.length <= 128 && !CONTROL_CHARS.test(entityId)) filters.entityId = entityId;
    else errors.push("Obyekt ID-si yanlışdır.");
  }

  const from = text(params.from);
  if (from) {
    if (bakuDayBounds(from)) filters.from = from;
    else errors.push("Başlanğıc tarixi YYYY-MM-DD formatında olmalıdır.");
  }
  const to = text(params.to);
  if (to) {
    if (bakuDayBounds(to)) filters.to = to;
    else errors.push("Son tarix YYYY-MM-DD formatında olmalıdır.");
  }
  if (filters.from && filters.to && filters.from > filters.to) {
    errors.push("Başlanğıc tarixi son tarixdən sonra ola bilməz.");
    delete filters.from;
    delete filters.to;
  }

  const q = text(params.q);
  if (q) {
    if (q.length <= 100 && !CONTROL_CHARS.test(q)) filters.q = q;
    else errors.push("Axtarış mətni 100 simvoldan çox ola bilməz.");
  }

  return { filters, errors };
}

/** Canonical, stable query string for pagination and export links. */
export function auditFiltersToSearchParams(filters: AuditLogFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.actor) params.set("actor", filters.actor.kind === "system" ? "system" : filters.actor.value);
  if (filters.action) params.set("action", filters.action);
  if (filters.entityType) params.set("entityType", filters.entityType);
  if (filters.entityId) params.set("entityId", filters.entityId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.q) params.set("q", filters.q);
  return params;
}

/** Filters as recorded in the AUDIT_EXPORT entry (the actor e-mail is reduced to its presence). */
export function auditFiltersForAudit(filters: AuditLogFilters): Record<string, string> {
  const out = Object.fromEntries(auditFiltersToSearchParams(filters));
  if (filters.actor?.kind === "email") out.actor = "email-filter";
  return out;
}

/** Escapes LIKE/ILIKE wildcards so free text matches literally (used with ESCAPE '\'). */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const SENSITIVE_EXACT = new Set(["ip", "ipaddress", "useragent", "user_agent", "cookie", "authorization", "otp", "recipient", "payload"]);
/** Keys such as `ip`, `sourceIp`, `client_ip`, `resetToken`, `codeHash`, `contactEmail`, `contactPhone`. */
export function isSensitiveMetadataKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_EXACT.has(lower)) return true;
  if (/(^ip|Ip|IP|_ip)$/.test(key) || /(^ip|Ip|IP|_ip)_?[Aa]ddress$/.test(key)) return true;
  return /(token|secret|password|hash|email|phone|useragent|user_agent)$/.test(lower);
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) =>
      [key, isSensitiveMetadataKey(key) ? "[gizlədilib]" : redact(item, depth + 1)]));
  }
  return value;
}

/** Compact, redacted rendering of the metadata JSON for the CSV "summary" column. */
export function summarizeAuditMetadata(metadata: unknown): string {
  if (metadata === null || metadata === undefined) return "";
  let rendered: string;
  try { rendered = JSON.stringify(redact(metadata)) ?? ""; } catch { return ""; }
  if (rendered === "{}") return "";
  return rendered.length > AUDIT_SUMMARY_MAX_LENGTH ? `${rendered.slice(0, AUDIT_SUMMARY_MAX_LENGTH - 1)}…` : rendered;
}

const bakuFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Baku", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function formatBakuDateTime(date: Date): string {
  const parts = Object.fromEntries(bakuFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function formatUtcDateTime(date: Date): string {
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

export type AuditExportRow = {
  createdAt: Date;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
};

export const AUDIT_CSV_HEADER = ["time_utc", "time_baku", "actor_id", "actor_role", "action", "entity_type", "entity_id", "summary"] as const;

/**
 * UTF-8 CSV with a BOM (so Excel shows Azerbaijani letters), CRLF line endings, every text cell quoted and
 * formula-injection protected. Rows beyond the cap are dropped and reported via `truncated`.
 */
export function buildAuditLogCsv(rows: readonly AuditExportRow[], maxRows = AUDIT_EXPORT_MAX_ROWS): { csv: string; rowCount: number; truncated: boolean } {
  const kept = rows.slice(0, maxRows);
  const lines = [AUDIT_CSV_HEADER.map(escapeAdminReportCsvCell).join(",")];
  for (const row of kept) {
    lines.push([
      formatUtcDateTime(row.createdAt),
      formatBakuDateTime(row.createdAt),
      row.actorId ?? "",
      row.actorId ? (row.actorRole ?? "") : "SYSTEM",
      row.action,
      row.entityType,
      row.entityId ?? "",
      summarizeAuditMetadata(row.metadata),
    ].map(escapeAdminReportCsvCell).join(","));
  }
  return { csv: `﻿${lines.join("\r\n")}\r\n`, rowCount: kept.length, truncated: rows.length > maxRows };
}
