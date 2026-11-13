import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { INCIDENT_STATUSES, listIncidents } from "@/lib/security-monitoring/admin";
import { authorizeSecurityAdmin, securityErrorResponse, securityJson } from "@/lib/security-monitoring/http";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
}).strict();

export async function GET(request: Request) {
  const auth = await authorizeSecurityAdmin(request, "security.view", { write: false });
  if ("response" in auth) return auth.response;
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return securityJson({ error: "Filtrlər yanlışdır." }, 422);
  try {
    return securityJson(await listIncidents(prisma, { ...parsed.data, pageSize: 25 }));
  } catch (error) {
    return securityErrorResponse("admin_security_incidents_list", error);
  }
}
