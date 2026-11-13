/**
 * Admin 2FA recovery codes: 10 single-use codes of 10 Crockford-base32 characters (50 bits each), shown once as
 * "XXXXX-XXXXX". Stored only as scrypt hashes with a per-code salt. They do not depend on BAGATI_ADMIN_2FA_KEY,
 * so an admin can still sign in with a recovery code if that key is lost or misconfigured.
 */
import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";

export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: no I, L, O, U.
const CODE_LENGTH = 10;
const SCRYPT = { N: 1 << 14, r: 8, p: 1, keyLength: 32, saltBytes: 16 } as const;

function scryptAsync(password: string, salt: Buffer, keyLength: number, options: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keyLength, { ...options, maxmem: 64 * 1024 * 1024 }, (error, derived) => error ? reject(error) : resolve(derived));
  });
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let code = "";
    for (let index = 0; index < CODE_LENGTH; index += 1) code += ALPHABET[randomInt(ALPHABET.length)];
    codes.add(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return [...codes];
}

/** Uppercases, drops spaces and dashes, and maps look-alikes (O→0, I/L→1). Returns null when not a code. */
export function normalizeRecoveryCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const clean = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (clean.length !== CODE_LENGTH) return null;
  for (const char of clean) if (!ALPHABET.includes(char)) return null;
  return clean;
}

export async function hashRecoveryCode(code: string): Promise<string> {
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) throw new Error("Invalid recovery code");
  const salt = randomBytes(SCRYPT.saltBytes);
  const derived = await scryptAsync(normalized, salt, SCRYPT.keyLength, SCRYPT);
  return ["scrypt", Math.log2(SCRYPT.N), SCRYPT.r, SCRYPT.p, salt.toString("base64url"), derived.toString("base64url")].join("$");
}

export async function verifyRecoveryCode(code: string, stored: string): Promise<boolean> {
  const normalized = normalizeRecoveryCode(code);
  const [scheme, logN, r, p, salt, hash] = stored.split("$");
  if (!normalized || scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const options = { N: 2 ** Number(logN), r: Number(r), p: Number(p) };
  if (![options.N, options.r, options.p].every(Number.isSafeInteger)) return false;
  const derived = await scryptAsync(normalized, Buffer.from(salt, "base64url"), expected.length, options);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
