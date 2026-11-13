/**
 * RFC 4226 HOTP / RFC 6238 TOTP with Node's crypto only. Defaults match authenticator apps:
 * HMAC-SHA1, 6 digits, 30-second steps. Pure functions; no database or environment access.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accept the previous, current and next step (clock drift of about +/-30s). */
export const TOTP_WINDOW = 1;
export const TOTP_SECRET_BYTES = 20;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/** Decodes RFC 4648 base32, ignoring case, spaces, dashes and padding. Returns null for invalid input. */
export function base32Decode(input: string): Buffer | null {
  const clean = input.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  if (!clean || /[^A-Z2-7]/.test(clean)) return null;
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export type TotpAlgorithm = "sha1" | "sha256" | "sha512";

export function hotp(key: Uint8Array, counter: number, digits = TOTP_DIGITS, algorithm: TotpAlgorithm = "sha1"): string {
  if (!Number.isSafeInteger(counter) || counter < 0) throw new RangeError("HOTP counter must be a non-negative safe integer");
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totpStep(timeMs: number, stepSeconds = TOTP_STEP_SECONDS): number {
  return Math.floor(timeMs / 1000 / stepSeconds);
}

export function totpAt(key: Uint8Array, timeMs: number, options: { digits?: number; algorithm?: TotpAlgorithm; stepSeconds?: number } = {}): string {
  return hotp(key, totpStep(timeMs, options.stepSeconds), options.digits, options.algorithm);
}

export function generateTotpSecret(): Buffer {
  return randomBytes(TOTP_SECRET_BYTES);
}

export function normalizeTotpCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.replace(/[\s-]/g, "");
  return new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(code) ? code : null;
}

export type TotpVerification =
  | { ok: true; step: number }
  | { ok: false; reason: "format" | "mismatch" | "replay" };

/**
 * Checks a code against steps current-window..current+window. A match on a step that is not newer than
 * `lastUsedStep` is a replay and is rejected, so each code (and every older one) can be used once.
 */
export function verifyTotp(input: { key: Uint8Array; code: unknown; nowMs: number; lastUsedStep: number | null; window?: number }): TotpVerification {
  const code = normalizeTotpCode(input.code);
  if (!code) return { ok: false, reason: "format" };
  const current = totpStep(input.nowMs);
  const window = input.window ?? TOTP_WINDOW;
  const expected = Buffer.from(code);
  let replay = false;
  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset;
    if (step < 0) continue;
    if (!timingSafeEqual(Buffer.from(hotp(input.key, step)), expected)) continue;
    if (input.lastUsedStep !== null && step <= input.lastUsedStep) { replay = true; continue; }
    return { ok: true, step };
  }
  return { ok: false, reason: replay ? "replay" : "mismatch" };
}

/** Key URI understood by authenticator apps. The secret is base32 without padding. */
export function otpauthUri(input: { issuer: string; account: string; secret: Uint8Array }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const params = new URLSearchParams({
    secret: base32Encode(input.secret),
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Manual-entry form of the secret, grouped in fours for readability. */
export function formatManualKey(secret: Uint8Array): string {
  return base32Encode(secret).replace(/(.{4})(?=.)/g, "$1 ");
}
