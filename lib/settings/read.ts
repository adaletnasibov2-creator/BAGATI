/**
 * Settings engine read path. Never throws for "ttl" keys:
 *   cached table (30 s) -> on database error the last good table -> code defaults;
 *   a missing row, a NULL value or a value that fails the registry schema -> the code default.
 * "uncached" keys (the default commission) are read inside the caller's transaction with readSettingInTransaction,
 * so an order can never use a value older than the moment it is created.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createFailSafeLoader } from "@/lib/fail-safe-cache";
import { getSettingDefinition, type SettingDefinition } from "@/lib/settings/registry";

export const SETTINGS_CACHE_TTL_MS = 30_000;

type Row = { key: string; value: unknown };

const loader = createFailSafeLoader<Map<string, unknown>>({
  label: "site-setting",
  ttlMs: SETTINGS_CACHE_TTL_MS,
  load: async () => new Map((await prisma.siteSetting.findMany({ select: { key: true, value: true } })).map((row: Row) => [row.key, row.value])),
  fallback: () => new Map(),
});

const invalidLoggedAt = new Map<string, number>();

/** Stored value -> validated value, or the code default. Logs an invalid stored value at most once a minute per key. */
export function resolveSettingValue<T>(definition: SettingDefinition<T>, stored: unknown, now = Date.now(), log: (line: string) => void = (line) => console.error(line)): T | null {
  if (stored === null || stored === undefined) return definition.default;
  const parsed = definition.schema.safeParse(stored);
  if (parsed.success) return parsed.data;
  if (now - (invalidLoggedAt.get(definition.key) ?? -Infinity) >= 60_000) {
    invalidLoggedAt.set(definition.key, now);
    log(JSON.stringify({ event: "site_setting.invalid_value", key: definition.key }));
  }
  return definition.default;
}

function definitionOrThrow(key: string) {
  const definition = getSettingDefinition(key);
  if (!definition) throw new Error(`Unknown setting key: ${key}`);
  return definition;
}

/** Cached read for "ttl" keys. Unknown keys are a programming error and throw at once. */
export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const definition = definitionOrThrow(key) as SettingDefinition<T>;
  if (definition.read !== "ttl") throw new Error(`Setting ${key} must be read inside its transaction (readSettingInTransaction)`);
  const table = await loader.get();
  return resolveSettingValue(definition, table.get(key));
}

/**
 * Uncached read inside the caller's transaction (one primary-key lookup). Database errors propagate: inside a
 * PostgreSQL transaction a failed statement aborts the transaction anyway, so the caller's work fails as a whole.
 */
export async function readSettingInTransaction<T = unknown>(tx: Prisma.TransactionClient, key: string): Promise<T | null> {
  const definition = definitionOrThrow(key) as SettingDefinition<T>;
  const row = await tx.siteSetting.findUnique({ where: { key }, select: { value: true } });
  return resolveSettingValue(definition, row?.value);
}

/** After a save in this process. Other processes pick the change up within SETTINGS_CACHE_TTL_MS. */
export function invalidateSettingsCache() {
  loader.invalidate();
}
