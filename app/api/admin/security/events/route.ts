import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import {
  SECURITY_EVENT_ACTIONS,
  SECURITY_EVENT_SEVERITIES,
  SECURITY_EVENT_SOURCES,
  SECURITY_EVENT_TYPES,
  SECURITY_EVENT_WINDOWS,
  securityEventWindowBucketCount,
  securityEventWindowStart,
} from "@/lib/security-event-ingestion";
import { securityIntegrationConfiguration } from "@/lib/security-integrations";
import { readSecurityEventDashboard } from "@/lib/security-event-store";
import { logSecurityOperationFailure } from "@/lib/security-logging";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  source: z.enum(SECURITY_EVENT_SOURCES).optional(),
  severity: z.enum(SECURITY_EVENT_SEVERITIES).optional(),
  eventType: z.enum(SECURITY_EVENT_TYPES).optional(),
  action: z.enum(SECURITY_EVENT_ACTIONS).optional(),
  window: z.enum(SECURITY_EVENT_WINDOWS).default("24h"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export async function GET(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur." }, { status: 403 });

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Axtarış filtrləri yanlışdır." }, { status: 422 });

  const { q, source, severity, eventType, action, window, page } = parsed.data;
  const pageSize = 50;
  const now = new Date();
  const recentSince = new Date(now.getTime() - 15 * 60 * 1000);
  const windowStart = securityEventWindowStart(window, now);
  const windowDuration = now.getTime() - windowStart.getTime();
  const previousWindowStart = new Date(windowStart.getTime() - windowDuration);
  try {
    const dashboard = await readSecurityEventDashboard({
      search: q,
      source,
      severity,
      eventType,
      action,
      windowStart,
      previousWindowStart,
      recentSince,
      bucketCount: securityEventWindowBucketCount(window),
      page,
      pageSize,
      now,
    });
    const integration = securityIntegrationConfiguration();

    return NextResponse.json({
      generatedAt: now.toISOString(),
      summary: {
        window,
        windowStart: windowStart.toISOString(),
        windowEnd: now.toISOString(),
        total: dashboard.total,
        severity: dashboard.severity,
        sources: dashboard.sourceActivity
          .filter((source) => source.windowCount > 0)
          .map(({ source, windowCount }) => ({ source, count: windowCount })),
        actions: dashboard.actions,
        eventTypes: dashboard.eventTypes,
        latestEventAt: dashboard.sourceActivity
          .map((source) => source.latestOccurredAt)
          .sort()
          .at(-1) ?? null,
        repeatedLoginSourcesLast15Minutes: dashboard.repeatedLoginSourcesLast15Minutes,
        previousWindowStart: previousWindowStart.toISOString(),
        previousWindowEnd: windowStart.toISOString(),
        previousWindowTotal: dashboard.trend.previousCount,
        windowChange: dashboard.trend.currentCount - dashboard.trend.previousCount,
      },
      events: dashboard.events.map((event) => ({
        ...event,
        occurredAt: event.occurredAt.toISOString(),
        receivedAt: event.receivedAt.toISOString(),
      })),
      timeline: dashboard.timeline,
      repeatedIps: dashboard.repeatedIps,
      priorityEvents: dashboard.priorityEvents.map((event) => ({
        ...event,
        occurredAt: event.occurredAt.toISOString(),
        receivedAt: event.receivedAt.toISOString(),
      })),
      page,
      pageSize,
      totalFiltered: dashboard.totalFiltered,
      integrations: {
        application: {
          producer: "implemented",
          instrumentedEventTypes: ["LOGIN_FAILURE", "RATE_LIMIT_VIOLATION"],
          lastReceivedAt: dashboard.sourceActivity.find((source) => source.source === "APPLICATION")?.latestReceivedAt ?? null,
          lastOccurredAt: dashboard.sourceActivity.find((source) => source.source === "APPLICATION")?.latestOccurredAt ?? null,
          eventsInWindow: dashboard.sourceActivity.find((source) => source.source === "APPLICATION")?.windowCount ?? 0,
          eventsLast15Minutes: dashboard.sourceActivity.find((source) => source.source === "APPLICATION")?.recentCount ?? 0,
        },
        cloudflare: {
          directApiAdapter: "not_implemented",
          relaySecretConfigured: integration.cloudflareRelaySecretConfigured,
          lastReceivedAt: dashboard.sourceActivity.find((source) => source.source === "CLOUDFLARE")?.latestReceivedAt ?? null,
          lastOccurredAt: dashboard.sourceActivity.find((source) => source.source === "CLOUDFLARE")?.latestOccurredAt ?? null,
          eventsInWindow: dashboard.sourceActivity.find((source) => source.source === "CLOUDFLARE")?.windowCount ?? 0,
          eventsLast15Minutes: dashboard.sourceActivity.find((source) => source.source === "CLOUDFLARE")?.recentCount ?? 0,
        },
        apache: {
          receiverConfigured: integration.apacheIngestSecretConfigured,
          lastReceivedAt: dashboard.sourceActivity.find((source) => source.source === "APACHE_MODSECURITY")?.latestReceivedAt ?? null,
          lastOccurredAt: dashboard.sourceActivity.find((source) => source.source === "APACHE_MODSECURITY")?.latestOccurredAt ?? null,
          eventsInWindow: dashboard.sourceActivity.find((source) => source.source === "APACHE_MODSECURITY")?.windowCount ?? 0,
          eventsLast15Minutes: dashboard.sourceActivity.find((source) => source.source === "APACHE_MODSECURITY")?.recentCount ?? 0,
        },
      },
      coverage: {
        applicationInstrumentedEventTypes: ["LOGIN_FAILURE", "RATE_LIMIT_VIOLATION"],
        applicationEventCounts: dashboard.applicationEventTypes,
        applicationNotInstrumentedEventTypes: ["SUSPICIOUS_PATH", "ABUSIVE_API", "WAF_EVENT"],
        apacheStoredFields: ["sourceIp", "path", "eventType", "severity", "action", "ruleId"],
        apacheMessageStored: false,
        cloudflareDirectIntegration: "not_implemented",
        ipBlocking: "not_implemented",
      },
      services: { eventStoreRead: "available", checkedAt: now.toISOString() },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logSecurityOperationFailure("admin_security_events_read", error);
    return NextResponse.json({ error: "Təhlükəsizlik məlumatlarını yükləmək mümkün olmadı." }, { status: 503 });
  }
}
