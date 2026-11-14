import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { addIncidentNote, readIncident } from "@/lib/security-monitoring/admin";
import { authorizeSecurityAdmin, INCIDENT_ID_PATTERN, readSecurityBody, securityErrorResponse, securityJson } from "@/lib/security-monitoring/http";
import { withSecurityTelemetry } from "@/lib/security-monitoring/runtime";

export const dynamic = "force-dynamic";

const noteSchema = z.object({ body: z.string().trim().min(1).max(2000) }).strict();

/** Adds a note. Order: same-origin -> ADMIN -> security.respond -> bounded body. */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeSecurityAdmin(request, "security.respond", { write: true });
  if ("response" in auth) return auth.response;
  const body = await readSecurityBody(request);
  if ("response" in body) return body.response;
  const { id } = await params;
  if (!INCIDENT_ID_PATTERN.test(id)) return securityJson({ error: "Tapılmadı." }, 404);
  const parsed = noteSchema.safeParse(body.value);
  if (!parsed.success) return securityJson({ error: "Qeyd 1–2000 simvol olmalıdır." }, 400);
  try {
    await addIncidentNote(prisma, { id, actorId: auth.admin.id, body: parsed.data.body });
    return securityJson({ ok: true, incident: await readIncident(prisma, id) }, 201);
  } catch (error) {
    return securityErrorResponse("admin_security_incident_note", error);
  }
}

export const POST = withSecurityTelemetry("admin.security", handlePOST);
