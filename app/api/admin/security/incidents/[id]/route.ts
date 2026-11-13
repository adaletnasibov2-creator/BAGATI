import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { INCIDENT_STATUSES, readIncident, updateIncident } from "@/lib/security-monitoring/admin";
import { authorizeSecurityAdmin, INCIDENT_ID_PATTERN, readSecurityBody, securityErrorResponse, securityJson } from "@/lib/security-monitoring/http";
import { withSecurityTelemetry } from "@/lib/security-monitoring/runtime";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  expectedStatus: z.enum(INCIDENT_STATUSES),
  status: z.enum(INCIDENT_STATUSES).optional(),
  assigneeId: z.string().regex(/^[a-z0-9]{8,40}$/).nullable().optional(),
  comment: z.string().trim().max(1500).nullish(),
}).strict();

export async function GET(request: Request, { params }: Context) {
  const auth = await authorizeSecurityAdmin(request, "security.view", { write: false });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!INCIDENT_ID_PATTERN.test(id)) return securityJson({ error: "Tapılmadı." }, 404);
  try {
    return securityJson({ incident: await readIncident(prisma, id) });
  } catch (error) {
    return securityErrorResponse("admin_security_incident_read", error);
  }
}

/** Status / assignee change. Order: same-origin -> ADMIN -> security.respond -> bounded body -> transition rules. */
async function handlePATCH(request: Request, { params }: Context) {
  const auth = await authorizeSecurityAdmin(request, "security.respond", { write: true });
  if ("response" in auth) return auth.response;
  const body = await readSecurityBody(request);
  if ("response" in body) return body.response;
  const { id } = await params;
  if (!INCIDENT_ID_PATTERN.test(id)) return securityJson({ error: "Tapılmadı." }, 404);
  const parsed = patchSchema.safeParse(body.value);
  if (!parsed.success) return securityJson({ error: "Sorğu məlumatı yanlışdır." }, 400);
  try {
    const result = await updateIncident(prisma, { id, actorId: auth.admin.id, ...parsed.data, comment: parsed.data.comment || null });
    return securityJson({ ok: true, ...result, incident: await readIncident(prisma, id) });
  } catch (error) {
    return securityErrorResponse("admin_security_incident_update", error);
  }
}

export const PATCH = withSecurityTelemetry("admin.security", handlePATCH);
