export const ADMIN_MAX_PAGE = 10_000;
export const ADMIN_MAX_SEARCH_LENGTH = 200;

export type AdminSearchParams = Record<string, string | string[] | undefined>;

export function normalizeAdminSearchParams(params: AdminSearchParams) {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(params)) {
    normalized[key] = typeof value === "string" ? value : undefined;
  }
  return normalized;
}

export function normalizeAdminPage(value: unknown) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  if (!Number.isSafeInteger(page) || page < 1) return 1;
  return Math.min(page, ADMIN_MAX_PAGE);
}

export function normalizeAdminSearch(value: unknown) {
  if (typeof value !== "string") return "";
  const search = value.trim();
  return search.length <= ADMIN_MAX_SEARCH_LENGTH ? search : "";
}

export function normalizeAdminEnumFilter<const Value extends string>(
  value: unknown,
  allowedValues: readonly Value[],
): Value | undefined {
  return typeof value === "string" ? allowedValues.find((allowed) => allowed === value) : undefined;
}
