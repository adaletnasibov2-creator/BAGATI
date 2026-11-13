import { randomUUID } from "node:crypto";
import { logAuthFailure } from "@/lib/auth-logging";
import { securityEventPathFromRequest } from "@/lib/security-event-ingestion";
import { clientIpHeaderMismatch } from "@/lib/trusted-proxy";
import { securityTelemetry } from "@/lib/security-monitoring/instance";
import { routeGroupForPath } from "@/lib/security-monitoring/telemetry";
import { insertSecurityEvent } from "@/lib/security-event-store";
import type { SecurityEventPayload } from "@/lib/security-event-ingestion";

export type SecurityEventSource = "APPLICATION" | "CLOUDFLARE" | "APACHE_MODSECURITY";

export async function persistSecurityEvent(input: {
  source: SecurityEventSource;
  event: SecurityEventPayload;
}) {
  return insertSecurityEvent(input);
}

export type ApplicationSecurityEventType = "LOGIN_FAILURE" | "RATE_LIMIT_VIOLATION" | "IP_HEADER_MISMATCH";

const EVENT_SEVERITY = { LOGIN_FAILURE: "MEDIUM", RATE_LIMIT_VIOLATION: "HIGH", IP_HEADER_MISMATCH: "HIGH" } as const;
const EVENT_ACTION = { LOGIN_FAILURE: "DENIED", RATE_LIMIT_VIOLATION: "BLOCKED", IP_HEADER_MISMATCH: "OBSERVED" } as const;

export async function recordApplicationSecurityEvent(input: {
  eventType: ApplicationSecurityEventType;
  path: string;
  sourceIp: string | null;
  occurredAt?: Date;
}) {
  const event = {
    eventId: randomUUID(),
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    ...(input.sourceIp ? { sourceIp: input.sourceIp } : {}),
    path: input.path,
    eventType: input.eventType,
    severity: EVENT_SEVERITY[input.eventType],
    action: EVENT_ACTION[input.eventType],
  };
  return persistSecurityEvent({ source: "APPLICATION", event });
}

export async function captureApplicationSecurityEvent(input: {
  request: Request;
  eventType: "LOGIN_FAILURE" | "RATE_LIMIT_VIOLATION";
  path: string;
}) {
  noteClientIpHeaderMismatch(input.request, input.path);
  if (input.eventType === "LOGIN_FAILURE") securityTelemetry.recordLoginFailure(routeGroupForPath(input.path));
  try {
    await recordApplicationSecurityEvent({
      eventType: input.eventType,
      path: input.path,
      sourceIp: securityEventPathFromRequest(input.request),
    });
  } catch (error) {
    logAuthFailure("security_event_capture", error);
  }
}

const MISMATCH_EVENT_INTERVAL_MS = 60_000;
const lastMismatchEventAt = new Map<string, number>();

/**
 * CF-Connecting-IP and X-Real-IP disagree on this request (the client IP is then treated as unknown; see
 * lib/trusted-proxy.ts). Records an IP_HEADER_MISMATCH SecurityEvent without the IP (it is not trustworthy), at most
 * once per path per minute per process, in the background. Never throws and never delays the request.
 * Returns whether a mismatch was seen (telemetry counts every occurrence).
 */
export function noteClientIpHeaderMismatch(request: Request, path: string, now = Date.now()): boolean {
  let mismatch = false;
  try { mismatch = clientIpHeaderMismatch(request.headers); } catch { return false; }
  if (!mismatch) return false;
  const key = path.slice(0, 120);
  if (now - (lastMismatchEventAt.get(key) ?? -Infinity) < MISMATCH_EVENT_INTERVAL_MS) return true;
  lastMismatchEventAt.set(key, now);
  if (lastMismatchEventAt.size > 500) lastMismatchEventAt.clear();
  void recordApplicationSecurityEvent({ eventType: "IP_HEADER_MISMATCH", path: key, sourceIp: null, occurredAt: new Date(now) })
    .catch((error) => logAuthFailure("security_event_ip_mismatch", error));
  return true;
}
