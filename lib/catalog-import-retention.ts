export type CatalogImportRetentionDays = {
  completed: number;
  failed: number;
  cancelled: number;
};

const DEFAULT_RETENTION_DAYS: CatalogImportRetentionDays = {
  completed: 90,
  failed: 180,
  cancelled: 30,
};

function retentionDays(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 3650 ? parsed : fallback;
}

export function catalogImportRetentionDays(
  env: Record<string, string | undefined> = process.env,
): CatalogImportRetentionDays {
  return {
    completed: retentionDays(env.CATALOG_IMPORT_COMPLETED_RETENTION_DAYS, DEFAULT_RETENTION_DAYS.completed),
    failed: retentionDays(env.CATALOG_IMPORT_FAILED_RETENTION_DAYS, DEFAULT_RETENTION_DAYS.failed),
    cancelled: retentionDays(env.CATALOG_IMPORT_CANCELLED_RETENTION_DAYS, DEFAULT_RETENTION_DAYS.cancelled),
  };
}
