import { randomUUID } from "node:crypto";
import { logAuthFailure } from "@/lib/auth-logging";
import { securityEventPathFromRequest } from "@/lib/security-event-ingestion";
import { insertSecurityEvent } from "@/lib/security-event-store";
import type { SecurityEventPayload } from "@/lib/security-event-ingestion";

export type SecurityEventSource = "APPLICATION" | "CLOUDFLARE" | "APACHE_MODSECURITY";

export async function persistSecurityEvent(input: {
  source: SecurityEventSource;
  event: SecurityEventPayload;
}) {
  return insertSecurityEvent(input);
}

export async function recordApplicationSecurityEvent(input: {
  eventType: "LOGIN_FAILURE" | "RATE_LIMIT_VIOLATION";
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
    severity: input.eventType === "RATE_LIMIT_VIOLATION" ? "HIGH" as const : "MEDIUM" as const,
    action: input.eventType === "RATE_LIMIT_VIOLATION" ? "BLOCKED" as const : "DENIED" as const,
  };
  return persistSecurityEvent({ source: "APPLICATION", event });
}

export async function captureApplicationSecurityEvent(input: {
  request: Request;
  eventType: "LOGIN_FAILURE" | "RATE_LIMIT_VIOLATION";
  path: string;
}) {
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
