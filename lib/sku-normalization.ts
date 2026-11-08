import { z } from "zod";

const SKU_EDGE_WHITESPACE = /^[\u0009-\u000D\u0020]+|[\u0009-\u000D\u0020]+$/g;

export function isWellFormedSku(value: unknown): boolean {
  if (typeof value !== "string" && typeof value !== "number") return value == null;
  const text = String(value);
  if (text.includes("\u0000")) return false;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function normalizeSku(value: unknown): string | null {
  if (!isWellFormedSku(value) || (typeof value !== "string" && typeof value !== "number")) return null;
  const normalized = String(value)
    .normalize("NFKC")
    .replace(SKU_EDGE_WHITESPACE, "")
    .replace(/[A-Z]/g, (character) => String.fromCharCode(character.charCodeAt(0) + 32));
  return normalized || null;
}

const skuTextSchema = z.string().max(80).refine(isWellFormedSku, "SKU contains unsupported text")
  .transform(normalizeSku)
  .refine((value) => value === null || value.length <= 80, "Normalized SKU exceeds 80 characters");

export const optionalSkuSchema = skuTextSchema.nullable().optional();
export const nullableSkuSchema = skuTextSchema.nullable();

export function hasDuplicateNormalizedSkus(values: readonly unknown[]): boolean {
  const seen = new Set<string>();
  for (const value of values) {
    const key = normalizeSku(value);
    if (!key) continue;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function sameJsonValue(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}
