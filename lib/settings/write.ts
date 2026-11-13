/**
 * Settings engine write path. Every change runs in ONE transaction:
 *   lock the row -> optimistic version check -> validated new value -> row update -> revision (with the previous
 *   value) -> audit entry with old -> new.
 * History is never rewritten: a reset and a rollback are new versions too. Callers invalidate the read cache after
 * the commit (invalidateSettingsCache).
 */
import { Prisma } from "@prisma/client";
import { getSettingDefinition, type SettingDefinition } from "@/lib/settings/registry";

export const SETTING_REASON = { min: 10, max: 500 } as const;
const AUDIT_TEXT_MAX = 200;

export type SettingErrorCode =
  | "UNKNOWN_KEY" | "INVALID" | "CONFIRM_REQUIRED" | "REASON_REQUIRED" | "VERSION_CONFLICT" | "REVISION_NOT_FOUND" | "NO_CHANGE";

export class SettingError extends Error {
  constructor(public readonly code: SettingErrorCode, public readonly detail: string = "") {
    super(code);
    this.name = "SettingError";
  }
}

export const SETTING_ERROR_RESPONSES: Record<SettingErrorCode, { status: number; error: string }> = {
  UNKNOWN_KEY: { status: 404, error: "Parametr tapılmadı." },
  INVALID: { status: 422, error: "Dəyəri yoxlayın." },
  CONFIRM_REQUIRED: { status: 422, error: "Bu dəyişiklik üçün təsdiq tələb olunur." },
  REASON_REQUIRED: { status: 422, error: `Dəyişikliyin səbəbini yazın (${SETTING_REASON.min}–${SETTING_REASON.max} simvol).` },
  VERSION_CONFLICT: { status: 409, error: "Bu parametr başqa admin tərəfindən dəyişdirilib. Səhifəni yeniləyin və yenidən yoxlayın." },
  REVISION_NOT_FOUND: { status: 404, error: "Bu versiya tapılmadı." },
  NO_CHANGE: { status: 422, error: "Dəyər onsuz da belədir; dəyişiklik yoxdur." },
};

type TransactionRunner = { $transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> };

export type SettingChange = {
  key: string;
  expectedVersion: number;
  actorId: string;
  reason?: string | null;
  confirm?: boolean;
};

/** Shortens long texts for audit metadata; the full value stays in the revision. */
export function auditValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.length <= AUDIT_TEXT_MAX) return value;
  return `${text.slice(0, AUDIT_TEXT_MAX)}… (${text.length} simvol)`;
}

/** Human-readable value for audit and history; a stored value that no longer validates is shown as such. */
export function displaySettingValue(definition: SettingDefinition, value: unknown): string {
  if (value === null || value === undefined) return definition.display(null);
  const parsed = definition.schema.safeParse(value);
  return parsed.success ? definition.display(parsed.data) : "yanlış dəyər";
}

function definitionOrThrow(key: string) {
  const definition = getSettingDefinition(key);
  if (!definition) throw new SettingError("UNKNOWN_KEY");
  return definition;
}

/** Sensitive keys: confirm: true and a 10–500 character reason. Other keys: an optional reason up to 500. */
export function checkSensitive(definition: SettingDefinition, input: { reason?: string | null; confirm?: boolean }): string | null {
  const reason = input.reason?.trim() || null;
  if (reason && reason.length > SETTING_REASON.max) throw new SettingError("REASON_REQUIRED");
  if (!definition.sensitive) return reason;
  if (input.confirm !== true) throw new SettingError("CONFIRM_REQUIRED");
  if (!reason || reason.length < SETTING_REASON.min) throw new SettingError("REASON_REQUIRED");
  return reason;
}

async function applyChange(db: TransactionRunner, definition: SettingDefinition, change: SettingChange, action: "UPDATE" | "RESET" | "ROLLBACK", resolveValue: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const reason = checkSensitive(definition, change);
  try {
    return await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ value: unknown; version: number }[]>`
        SELECT "value", "version" FROM "SiteSetting" WHERE "key" = ${definition.key} FOR UPDATE`;
      const current = rows[0];
      const currentVersion = current?.version ?? 0;
      if (change.expectedVersion !== currentVersion) throw new SettingError("VERSION_CONFLICT");
      const previous = current?.value ?? null;
      const next = await resolveValue(tx);
      if (JSON.stringify(previous) === JSON.stringify(next)) throw new SettingError("NO_CHANGE");
      const version = currentVersion + 1;
      const stored = next === null ? Prisma.DbNull : (next as Prisma.InputJsonValue);
      if (current) {
        const updated = await tx.siteSetting.updateMany({ where: { key: definition.key, version: currentVersion }, data: { value: stored, version, updatedById: change.actorId } });
        if (updated.count !== 1) throw new SettingError("VERSION_CONFLICT");
      } else {
        await tx.siteSetting.create({ data: { key: definition.key, value: stored, version, updatedById: change.actorId } });
      }
      const revision = await tx.siteSettingRevision.create({
        data: {
          key: definition.key,
          version,
          value: stored,
          previousValue: previous === null ? Prisma.DbNull : (previous as Prisma.InputJsonValue),
          action,
          reason,
          changedById: change.actorId,
        },
        select: { id: true, createdAt: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: change.actorId,
          action: "SITE_SETTING_UPDATE",
          entityType: "SiteSetting",
          entityId: definition.key,
          metadata: {
            key: definition.key,
            change: action,
            from: auditValue(previous),
            to: auditValue(next),
            fromDisplay: displaySettingValue(definition, previous),
            toDisplay: displaySettingValue(definition, next),
            version,
            revisionId: revision.id,
            sensitive: definition.sensitive,
            ...(reason ? { reason: auditValue(reason) } : {}),
          } as Prisma.InputJsonValue,
        },
      });
      return { key: definition.key, version, value: next, revisionId: revision.id, changedAt: revision.createdAt };
    });
  } catch (error) {
    // Two first writes of the same key at once: the loser hits the primary key.
    if (typeof error === "object" && error && "code" in error && (error as { code: unknown }).code === "P2002") throw new SettingError("VERSION_CONFLICT");
    throw error;
  }
}

/** New value from the admin form (input format, e.g. percent "10"). */
export async function updateSetting(db: TransactionRunner, change: SettingChange & { input: unknown }) {
  const definition = definitionOrThrow(change.key);
  const parsed = definition.inputSchema.safeParse(change.input);
  if (!parsed.success) throw new SettingError("INVALID", parsed.error.issues[0]?.message ?? "");
  const value = definition.schema.safeParse(parsed.data);
  if (!value.success) throw new SettingError("INVALID", value.error.issues[0]?.message ?? "");
  return applyChange(db, definition, change, "UPDATE", async () => value.data);
}

/** Back to the code default (stored as NULL). */
export async function resetSetting(db: TransactionRunner, change: SettingChange) {
  const definition = definitionOrThrow(change.key);
  return applyChange(db, definition, change, "RESET", async () => null);
}

/** Restores the value of an earlier revision as a NEW version. The value must still pass today's schema. */
export async function rollbackSetting(db: TransactionRunner, change: SettingChange & { revisionId: string }) {
  const definition = definitionOrThrow(change.key);
  return applyChange(db, definition, change, "ROLLBACK", async (tx) => {
    const revision = await tx.siteSettingRevision.findFirst({ where: { id: change.revisionId, key: definition.key }, select: { value: true } });
    if (!revision) throw new SettingError("REVISION_NOT_FOUND");
    if (revision.value === null) return null;
    const value = definition.schema.safeParse(revision.value);
    if (!value.success) throw new SettingError("INVALID", "Bu versiyanın dəyəri artıq icazə verilən hədlərdə deyil.");
    return value.data;
  });
}
