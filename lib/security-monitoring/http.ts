import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { csrfRejection } from "@/lib/csrf";
import { readJsonBodyLimited } from "@/lib/request-json";
import { logSecurityOperationFailure } from "@/lib/security-logging";
import { SECURITY_ADMIN_ERROR_RESPONSES, SecurityAdminError } from "@/lib/security-monitoring/admin";
import { requireSecurityPermission, type SecurityPermission } from "@/lib/security-monitoring/permissions";

export const SECURITY_ADMIN_BODY_BYTES = 8 * 1024;
export const INCIDENT_ID_PATTERN = /^[a-z0-9]{8,40}$/;

export const securityJson = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

type AdminUser = { id: string; role: Role; email: string };

/**
 * Order for every Security Center admin route: same-origin (writes only) -> ADMIN session -> Security Center
 * permission. The body is read only afterwards, bounded (readSecurityBody).
 */
export async function authorizeSecurityAdmin(request: Request, permission: SecurityPermission, options: { write: boolean }): Promise<{ admin: AdminUser } | { response: NextResponse }> {
  if (options.write) {
    const crossSite = csrfRejection(request);
    if (crossSite) return { response: crossSite };
  }
  const admin = await requireRole("ADMIN");
  if (!admin) return { response: securityJson({ error: "İcazə yoxdur." }, 403) };
  if (!requireSecurityPermission(admin, permission)) return { response: securityJson({ error: "Bu əməliyyat üçün icazəniz yoxdur." }, 403) };
  return { admin };
}

export async function readSecurityBody(request: Request): Promise<{ value: unknown } | { response: NextResponse }> {
  const body = await readJsonBodyLimited(request, SECURITY_ADMIN_BODY_BYTES);
  if (!body.ok) return { response: securityJson({ error: "Sorğu məlumatı yanlışdır." }, body.status) };
  return { value: body.value };
}

export function securityErrorResponse(operation: string, error: unknown) {
  if (error instanceof SecurityAdminError) {
    const mapped = SECURITY_ADMIN_ERROR_RESPONSES[error.code];
    return securityJson({ error: mapped.error, code: error.code }, mapped.status);
  }
  logSecurityOperationFailure(operation, error);
  return securityJson({ error: "Əməliyyatı indi yerinə yetirmək mümkün olmadı." }, 500);
}
