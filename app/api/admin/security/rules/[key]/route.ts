import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { listRules, resetRule, updateRule } from "@/lib/security-monitoring/admin";
import { authorizeSecurityAdmin, readSecurityBody, securityErrorResponse, securityJson } from "@/lib/security-monitoring/http";
import { ruleSettingsSchema } from "@/lib/security-monitoring/rules";
import { withSecurityTelemetry } from "@/lib/security-monitoring/runtime";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ key: string }> };
const KEY_PATTERN = /^[a-z][a-z0-9_]{1,47}$/;
const updateSchema = z.object({ settings: ruleSettingsSchema, expectedVersion: z.number().int().min(0) }).strict();
const resetSchema = z.object({ expectedVersion: z.number().int().min(0) }).strict();

async function respond(key: string, version: number) {
  const rule = (await listRules(prisma)).find((item) => item.key === key);
  return securityJson({ ok: true, version, rule });
}

/** Saves a rule override. Order: same-origin -> ADMIN -> security.rules -> bounded body -> bounds + version check. */
async function handlePUT(request: Request, { params }: Context) {
  const auth = await authorizeSecurityAdmin(request, "security.rules", { write: true });
  if ("response" in auth) return auth.response;
  const body = await readSecurityBody(request);
  if ("response" in body) return body.response;
  const { key } = await params;
  if (!KEY_PATTERN.test(key)) return securityJson({ error: "Belə qayda yoxdur.", code: "UNKNOWN_RULE" }, 404);
  const parsed = updateSchema.safeParse(body.value);
  if (!parsed.success) return securityJson({ error: "Dəyərlər icazə verilən hədlərdən kənardır." }, 400);
  try {
    const result = await updateRule(prisma, { key, actorId: auth.admin.id, ...parsed.data });
    return await respond(key, result.version);
  } catch (error) {
    return securityErrorResponse("admin_security_rule_update", error);
  }
}

/** Removes the override (the code default applies again). Same order as PUT. */
async function handleDELETE(request: Request, { params }: Context) {
  const auth = await authorizeSecurityAdmin(request, "security.rules", { write: true });
  if ("response" in auth) return auth.response;
  const body = await readSecurityBody(request);
  if ("response" in body) return body.response;
  const { key } = await params;
  if (!KEY_PATTERN.test(key)) return securityJson({ error: "Belə qayda yoxdur.", code: "UNKNOWN_RULE" }, 404);
  const parsed = resetSchema.safeParse(body.value);
  if (!parsed.success) return securityJson({ error: "Sorğu məlumatı yanlışdır." }, 400);
  try {
    const result = await resetRule(prisma, { key, actorId: auth.admin.id, ...parsed.data });
    return await respond(key, result.version);
  } catch (error) {
    return securityErrorResponse("admin_security_rule_reset", error);
  }
}

export const PUT = withSecurityTelemetry("admin.security", handlePUT);
export const DELETE = withSecurityTelemetry("admin.security", handleDELETE);
