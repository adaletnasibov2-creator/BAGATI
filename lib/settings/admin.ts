/**
 * Plain, serialisable view of the settings of one group for the admin UI (read directly from the database, uncached,
 * so the page always shows the stored state and the current version). Client components get only this data;
 * they never import lib/settings.
 */
import type { Prisma } from "@prisma/client";
import { formatBakuDateTime } from "@/lib/admin-audit-log";
import { SETTING_DEFINITIONS, SETTING_GROUPS, type SettingGroupId, type SettingInput } from "@/lib/settings/registry";
import { resolveSettingValue } from "@/lib/settings/read";
import { displaySettingValue, SETTING_REASON } from "@/lib/settings/write";

export const SETTING_HISTORY_LIMIT = 20;

export type AdminSettingHistoryItem = {
  id: string;
  version: number;
  action: "UPDATE" | "RESET" | "ROLLBACK";
  valueDisplay: string;
  previousDisplay: string;
  reason: string | null;
  changedBy: string;
  changedAt: string;
  /** Restorable: not the current version, a different value from the current one, and still valid under today's rules. */
  restorable: boolean;
};

export type AdminSettingView = {
  key: string;
  label: string;
  description: string;
  sensitive: boolean;
  sensitiveNotice: string | null;
  input: SettingInput;
  currentInput: string;
  currentDisplay: string;
  defaultDisplay: string;
  isDefault: boolean;
  version: number;
  changedBy: string | null;
  changedAt: string | null;
  storedValueInvalid: boolean;
  reason: { min: number; max: number };
  history: AdminSettingHistoryItem[];
};

export async function loadAdminSettingsGroup(db: Prisma.TransactionClient, group: SettingGroupId) {
  const definitions = SETTING_DEFINITIONS.filter((definition) => definition.group === group);
  const keys = definitions.map((definition) => definition.key);
  const [rows, revisions] = await Promise.all([
    db.siteSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true, version: true, updatedAt: true, updatedBy: { select: { email: true } } } }),
    db.siteSettingRevision.findMany({
      where: { key: { in: keys } },
      orderBy: [{ key: "asc" }, { version: "desc" }],
      select: { id: true, key: true, version: true, action: true, value: true, previousValue: true, reason: true, createdAt: true, changedBy: { select: { email: true } } },
    }),
  ]);
  const settings: AdminSettingView[] = definitions.map((definition) => {
    const row = rows.find((item) => item.key === definition.key);
    const stored = row?.value ?? null;
    const value = resolveSettingValue(definition, stored, Date.now(), () => undefined);
    const storedValueInvalid = stored !== null && !definition.schema.safeParse(stored).success;
    const history = revisions.filter((item) => item.key === definition.key).slice(0, SETTING_HISTORY_LIMIT).map((item) => ({
      id: item.id,
      version: item.version,
      action: item.action,
      valueDisplay: displaySettingValue(definition, item.value),
      previousDisplay: displaySettingValue(definition, item.previousValue),
      reason: item.reason,
      changedBy: item.changedBy?.email ?? "silinmiş istifadəçi",
      changedAt: formatBakuDateTime(item.createdAt),
      restorable: item.version !== row?.version
        && JSON.stringify(item.value ?? null) !== JSON.stringify(stored)
        && (item.value === null || definition.schema.safeParse(item.value).success),
    }));
    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      sensitive: definition.sensitive,
      sensitiveNotice: definition.sensitiveNotice ?? null,
      input: definition.input,
      currentInput: value === null ? "" : definition.toInput(value),
      currentDisplay: definition.display(value),
      defaultDisplay: definition.display(definition.default),
      isDefault: stored === null || storedValueInvalid,
      version: row?.version ?? 0,
      changedBy: row ? row.updatedBy?.email ?? "silinmiş istifadəçi" : null,
      changedAt: row ? formatBakuDateTime(row.updatedAt) : null,
      storedValueInvalid,
      reason: { ...SETTING_REASON },
      history,
    };
  });
  return { group: SETTING_GROUPS[group], settings };
}

/** Current value of one setting for a read-only summary (uncached; e.g. the default commission on /admin/commissions). */
export async function loadSettingSummary(db: Prisma.TransactionClient, key: string) {
  const definition = SETTING_DEFINITIONS.find((item) => item.key === key);
  if (!definition) throw new Error(`Unknown setting key: ${key}`);
  const row = await db.siteSetting.findUnique({ where: { key }, select: { value: true } });
  const value = resolveSettingValue(definition, row?.value ?? null, Date.now(), () => undefined);
  return { key, label: definition.label, display: definition.display(value), isSet: value !== null };
}
