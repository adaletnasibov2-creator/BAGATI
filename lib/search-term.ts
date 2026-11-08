export const PRODUCT_SEARCH_MAX_LENGTH = 120;
export const STORE_SEARCH_MAX_LENGTH = 120;

export function normalizePublicSearchTerm(value: string | null | undefined, maxLength: number) {
  if (!Number.isInteger(maxLength) || maxLength < 1) throw new RangeError("SEARCH_TERM_LIMIT_INVALID");
  const normalized = value?.trim() ?? "";
  if (normalized.length > maxLength) return { value: undefined, tooLong: true } as const;
  return { value: normalized || undefined, tooLong: false } as const;
}
