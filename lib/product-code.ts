/** A seller-friendly internal product code; it is not a barcode. */
export function generateProductCode(id: string = crypto.randomUUID()): string {
  const compact = id.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (compact.length < 16) throw new Error("PRODUCT_CODE_ID_INVALID");
  return `BGT-${compact.slice(0, 16)}`;
}

/**
 * Code for an existing product: derived from its id when the id is long enough
 * (cuid/UUID), otherwise a fresh random code. Never throws for legacy or seeded ids.
 */
export function productCodeFor(id: string): string {
  try {
    return generateProductCode(id);
  } catch {
    return generateProductCode();
  }
}
