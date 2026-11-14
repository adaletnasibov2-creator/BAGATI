import { NextResponse } from "next/server";
import {
  readBoundedRequestBody,
  securityEventTypeAllowedForSource,
  securityEventPayloadSchema,
  verifySecurityIngestSignature,
} from "@/lib/security-event-ingestion";
import { persistSecurityEvent, type SecurityEventSource } from "@/lib/security-events";
import { logSecurityOperationFailure } from "@/lib/security-logging";
import { withSecurityTelemetry } from "@/lib/security-monitoring/runtime";

export const dynamic = "force-dynamic";

type ExternalSecurityEventSource = Exclude<SecurityEventSource, "APPLICATION">;
const sourceSecrets: Record<string, { source: ExternalSecurityEventSource; environmentVariable: string }> = {
  cloudflare: { source: "CLOUDFLARE", environmentVariable: "BAGATI_CLOUDFLARE_INGEST_SECRET" },
  apache: { source: "APACHE_MODSECURITY", environmentVariable: "BAGATI_APACHE_INGEST_SECRET" },
};

async function handlePOST(request: Request, { params }: { params: Promise<{ source: string }> }) {
  const { source: sourceName } = await params;
  const source = sourceSecrets[sourceName];
  if (!source) return NextResponse.json({ error: "Məlumat mənbəyi dəstəklənmir." }, { status: 404 });

  const secret = process.env[source.environmentVariable];
  if (!secret || secret.length < 32) {
    return NextResponse.json({ error: "İnteqrasiya konfiqurasiya edilməyib." }, { status: 503 });
  }

  let body: string;
  try {
    body = await readBoundedRequestBody(request);
  } catch (error) {
    if (error instanceof Error && error.message === "BODY_TOO_LARGE") {
      return NextResponse.json({ error: "Sorğu ölçüsü icazə verilən həddi keçir." }, { status: 413 });
    }
    logSecurityOperationFailure("security_ingest_body_read", error);
    return NextResponse.json({ error: "Sorğunu oxumaq mümkün olmadı." }, { status: 400 });
  }

  const timestamp = request.headers.get("x-bagati-timestamp") ?? "";
  const signature = request.headers.get("x-bagati-signature") ?? "";
  if (!verifySecurityIngestSignature({ secret, timestamp, signature, body })) {
    return NextResponse.json({ error: "İmza yanlışdır və ya vaxtı keçib." }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "JSON formatı yanlışdır." }, { status: 400 });
  }
  const parsed = securityEventPayloadSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Təhlükəsizlik hadisəsinin sahələri yanlışdır." }, { status: 422 });

  if (!securityEventTypeAllowedForSource(source.source, parsed.data.eventType)) {
    return NextResponse.json({ error: "Hadisə növü bu mənbə üçün dəstəklənmir." }, { status: 422 });
  }

  try {
    const result = await persistSecurityEvent({ source: source.source, event: parsed.data });
    return NextResponse.json(
      { accepted: true, duplicate: result.kind === "duplicate" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logSecurityOperationFailure("security_event_persist", error);
    return NextResponse.json({ error: "Təhlükəsizlik hadisəsini saxlamaq mümkün olmadı." }, { status: 503 });
  }
}

/** Security Center telemetry: status and duration counted under "security.ingest" (never affects the response). */
export const POST = withSecurityTelemetry("security.ingest", handlePOST);
