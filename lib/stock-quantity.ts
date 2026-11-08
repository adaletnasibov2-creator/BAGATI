import { z } from "zod";

const STOCK_MAX = 1_000_000;

export type ParsedStock =
  | { ok: true; omitted: true }
  | { ok: true; omitted: false; value: number }
  | { ok: false };

/** Distinguishes a missing field, an explicit zero, and an empty or invalid value. */
export function parseStockQuantity(value: unknown): ParsedStock {
  if (value === undefined) return { ok: true, omitted: true };
  if (value === null || typeof value === "boolean") return { ok: false };
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || value > STOCK_MAX) return { ok: false };
    return { ok: true, omitted: false, value };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || !/^(0|[1-9]\d{0,6})$/.test(trimmed)) return { ok: false };
    const parsed = Number(trimmed);
    if (parsed > STOCK_MAX) return { ok: false };
    return { ok: true, omitted: false, value: parsed };
  }
  return { ok: false };
}

export function presentStockQuantity(value: unknown): number | null {
  const parsed = parseStockQuantity(value);
  if (!parsed.ok) return null;
  if (parsed.omitted) return null;
  return parsed.value;
}

export const requiredStockQuantitySchema = z.custom<number>((value) => {
  const parsed = parseStockQuantity(value);
  return parsed.ok && !parsed.omitted;
}, "Stok miqdarı 0 və 1000000 arasında tam ədəd olmalıdır").transform((value) => {
  const parsed = parseStockQuantity(value);
  if (!parsed.ok) throw new Error("INVALID_STOCK");
  if (parsed.omitted) throw new Error("INVALID_STOCK");
  return parsed.value;
});

export const optionalStockQuantitySchema = requiredStockQuantitySchema.optional();
