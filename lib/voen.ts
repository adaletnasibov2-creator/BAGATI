/**
 * VÖEN (Azerbaijani taxpayer identification number) format rules. Pure: used by forms in the browser and by every
 * server path that accepts a VÖEN.
 *
 * Accepted: exactly 10 ASCII digits (0-9) after removing spaces; the last digit is 1 (legal entity) or 2 (natural
 * person / sole entrepreneur). Anything else is rejected, including dashes, letters and non-ASCII digits.
 *
 * This checks the FORMAT only. It does not mean the number is registered: an admin verifies that manually on the
 * official e-taxes taxpayer search (there is no public API, and the server never calls e-taxes).
 */
export type VoenKind = "LEGAL_ENTITY" | "NATURAL_PERSON";
export type VoenErrorCode = "EMPTY" | "CHARACTERS" | "LENGTH" | "LAST_DIGIT";
export type VoenParseResult = { ok: true; voen: string; kind: VoenKind } | { ok: false; code: VoenErrorCode; error: string };

export const VOEN_MESSAGES: Record<VoenErrorCode, string> = {
  EMPTY: "VÖEN-i daxil edin.",
  CHARACTERS: "VÖEN yalnız rəqəmlərdən (0–9) ibarət olmalıdır.",
  LENGTH: "VÖEN 10 rəqəmdən ibarət olmalıdır.",
  LAST_DIGIT: "VÖEN-in sonuncu rəqəmi 1 (hüquqi şəxs) və ya 2 (fiziki şəxs / fərdi sahibkar) olmalıdır.",
};

/** Help text under every VÖEN field. Says nothing about the number being "real". */
export const VOEN_HELP = "10 rəqəm, sonuncu rəqəm 1 və ya 2. Boşluqlar avtomatik silinir.";
export const VOEN_ADMIN_NOTE = "VÖEN-i BAGATI admini vergi orqanının rəsmi axtarışında yoxlayıb təsdiqləyir.";

/** Official public taxpayer search (no login): taxes.gov.az "E-Xidmətlər" → redirect/282 → this page (checked 2026-11-15). */
export const VOEN_LOOKUP_URL = "https://new.e-taxes.gov.az/etaxes/services/taxpayer-info";

// Whitespace of any kind (incl. no-break and zero-width spaces, BOM) is removed; nothing else is.
const SPACES = /[\s​-‍⁠﻿]/g;

export function parseVoen(input: unknown): VoenParseResult {
  const fail = (code: VoenErrorCode): VoenParseResult => ({ ok: false, code, error: VOEN_MESSAGES[code] });
  if (typeof input !== "string") return fail("EMPTY");
  const value = input.replace(SPACES, "");
  if (!value) return fail("EMPTY");
  if (!/^[0-9]+$/.test(value)) return fail("CHARACTERS");
  if (value.length !== 10) return fail("LENGTH");
  const last = value[9];
  if (last !== "1" && last !== "2") return fail("LAST_DIGIT");
  return { ok: true, voen: value, kind: last === "1" ? "LEGAL_ENTITY" : "NATURAL_PERSON" };
}

export function isValidVoen(input: unknown): boolean {
  return parseVoen(input).ok;
}

export function voenKindLabel(kind: VoenKind): string {
  return kind === "LEGAL_ENTITY" ? "Hüquqi şəxs" : "Fiziki şəxs / fərdi sahibkar";
}

/** "•••••••891" for lists and audit metadata; the full VÖEN only on admin detail views. */
export function maskVoenDigits(voen: string | null | undefined): string {
  const digits = (voen ?? "").replace(/\D/g, "");
  if (!digits) return "—";
  return `${"•".repeat(Math.max(0, digits.length - 3))}${digits.slice(-3)}`;
}
