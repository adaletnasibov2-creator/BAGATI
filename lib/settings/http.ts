import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { readJsonBodyLimited } from "@/lib/request-json";
import { getSettingDefinition } from "@/lib/settings/registry";
import { requireSettingPermission } from "@/lib/settings/permissions";
import { invalidateSettingsCache } from "@/lib/settings/read";
import { resetSetting, rollbackSetting, SETTING_ERROR_RESPONSES, SettingError, updateSetting } from "@/lib/settings/write";

const headers = { "Cache-Control": "no-store" };
export const settingJson = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers });
export const SETTINGS_BODY_BYTES = 8 * 1024;
const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

const common = { expectedVersion: z.number().int().min(0), reason: z.string().max(2000).nullish(), confirm: z.boolean().optional() };
const updateBody = z.object({ value: z.unknown(), ...common }).strict();
const resetBody = z.object(common).strict();
const rollbackBody = z.object({ revisionId: z.string().min(1).max(64), ...common }).strict();

/**
 * Second half of PUT /api/admin/settings/[key], POST .../reset and POST .../restore (action "rollback"). The route has already
 * checked same-origin and ADMIN (in that order). Here: settings permission of the key -> bounded JSON body ->
 * unknown key 404 -> registry validation and sensitive checks (lib/settings/write.ts) -> one transaction.
 */
export async function handleSettingWrite(request: Request, admin: { id: string; role: Role }, rawKey: string, action: "update" | "reset" | "rollback") {
  const definition = KEY_PATTERN.test(rawKey) ? getSettingDefinition(rawKey) : undefined;
  if (!requireSettingPermission(admin, definition?.permission ?? null)) return settingJson({ error: "Bu parametri dəyişmək üçün icazəniz yoxdur." }, 403);
  const body = await readJsonBodyLimited(request, SETTINGS_BODY_BYTES);
  if (!body.ok) return settingJson({ error: "Sorğu məlumatı yanlışdır" }, body.status);
  if (!definition) return settingJson({ error: SETTING_ERROR_RESPONSES.UNKNOWN_KEY.error, code: "UNKNOWN_KEY" }, 404);

  try {
    let result;
    if (action === "update") {
      const parsed = updateBody.safeParse(body.value);
      if (!parsed.success) return settingJson({ error: "Sorğu məlumatı yanlışdır" }, 400);
      result = await updateSetting(prisma, { key: definition.key, actorId: admin.id, ...parsed.data, input: parsed.data.value });
    } else if (action === "reset") {
      const parsed = resetBody.safeParse(body.value);
      if (!parsed.success) return settingJson({ error: "Sorğu məlumatı yanlışdır" }, 400);
      result = await resetSetting(prisma, { key: definition.key, actorId: admin.id, ...parsed.data });
    } else {
      const parsed = rollbackBody.safeParse(body.value);
      if (!parsed.success) return settingJson({ error: "Sorğu məlumatı yanlışdır" }, 400);
      result = await rollbackSetting(prisma, { key: definition.key, actorId: admin.id, ...parsed.data });
    }
    invalidateSettingsCache();
    return settingJson({ ok: true, key: result.key, version: result.version, message: "Parametr yadda saxlanıldı." });
  } catch (error) {
    if (error instanceof SettingError) {
      const response = SETTING_ERROR_RESPONSES[error.code];
      return settingJson({ error: error.detail || response.error, code: error.code }, response.status);
    }
    console.error(JSON.stringify({ event: "site_setting.write_failed", key: definition.key, error: error instanceof Error ? error.name : "unknown" }));
    return settingJson({ error: "Parametri indi yadda saxlamaq mümkün olmadı." }, 500);
  }
}
