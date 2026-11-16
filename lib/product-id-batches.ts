/** Shared by the favorites page (browser) and GET /api/products?ids= (server). No server imports here. */
export const PUBLIC_PRODUCT_BATCH_MAX_IDS = 50;
export const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Saved favorite ids -> request batches of at most 50: ids the server would reject are dropped first (so one bad entry
 * in localStorage cannot hide the other favorites of its batch), duplicates removed, order kept.
 */
export function productIdBatches(ids: readonly unknown[], size = PUBLIC_PRODUCT_BATCH_MAX_IDS): string[][] {
  const valid = [...new Set(ids.filter((id): id is string => typeof id === "string" && PRODUCT_ID_PATTERN.test(id)))];
  const batches: string[][] = [];
  for (let index = 0; index < valid.length; index += size) batches.push(valid.slice(index, index + size));
  return batches;
}
