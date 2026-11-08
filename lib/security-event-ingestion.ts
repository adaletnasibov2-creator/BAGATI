import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { readBoundedRequestBody as readBoundedBody } from "@/lib/request-body";
import { trustedCloudflareClientIp } from "@/lib/trusted-proxy";
import {
  SECURITY_EVENT_ACTIONS,
  SECURITY_EVENT_SEVERITIES,
  SECURITY_EVENT_SOURCES,
  SECURITY_EVENT_TYPES,
  SECURITY_EVENT_WINDOWS,
  securityEventWindowBucketCount,
  securityEventWindowStart,
} from "@/lib/security-event-types";

export {
  SECURITY_EVENT_ACTIONS,
  SECURITY_EVENT_SEVERITIES,
  SECURITY_EVENT_SOURCES,
  SECURITY_EVENT_TYPES,
  SECURITY_EVENT_WINDOWS,
  securityEventWindowBucketCount,
  securityEventWindowStart,
};

export const securityEventPayloadSchema = z.object({
  eventId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  occurredAt: z.string().datetime({ offset: true }),
  sourceIp: z.string().max(45).refine((value) => isIP(value) !== 0).optional(),
  path: z.string().min(1).max(500).startsWith("/").refine((value) => !/[?#\r\n]/.test(value)).optional(),
  eventType: z.enum(SECURITY_EVENT_TYPES),
  severity: z.enum(SECURITY_EVENT_SEVERITIES),
  action: z.enum(SECURITY_EVENT_ACTIONS),
  ruleId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
}).strict();

export type SecurityEventPayload = z.infer<typeof securityEventPayloadSchema>;

export const SECURITY_INGEST_MAX_BYTES = 16 * 1024;
export const SECURITY_INGEST_MAX_CLOCK_SKEW_SECONDS = 5 * 60;

export function verifySecurityIngestSignature(input: {
  secret: string;
  timestamp: string;
  signature: string;
  body: string;
  nowSeconds?: number;
}) {
  if (input.secret.length < 32 || !/^\d{10}$/.test(input.timestamp) || !/^[a-f0-9]{64}$/i.test(input.signature)) {
    return false;
  }

  const timestamp = Number(input.timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > SECURITY_INGEST_MAX_CLOCK_SKEW_SECONDS) {
    return false;
  }

  const expected = createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.body}`, "utf8")
    .digest();
  const supplied = Buffer.from(input.signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function signSecurityIngestPayload(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

export function hashSecurityEventId(source: string, eventId: string) {
  return createHash("sha256").update(`${source}\0${eventId}`, "utf8").digest("hex");
}

export function securityEventTypeAllowedForSource(source: "CLOUDFLARE" | "APACHE_MODSECURITY", eventType: string) {
  return source === "CLOUDFLARE"
    ? ["WAF_EVENT", "SUSPICIOUS_PATH", "ABUSIVE_API", "RATE_LIMIT_VIOLATION"].includes(eventType)
    : ["MODSECURITY_EVENT", "SUSPICIOUS_PATH", "ABUSIVE_API", "RATE_LIMIT_VIOLATION"].includes(eventType);
}

export function readBoundedRequestBody(request: Request, maxBytes = SECURITY_INGEST_MAX_BYTES) {
  return readBoundedBody(request, maxBytes);
}

export function securityEventPathFromRequest(request: Request) {
  return trustedCloudflareClientIp(request.headers);
}
