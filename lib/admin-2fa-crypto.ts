/**
 * Encryption of admin TOTP secrets at rest.
 *
 * Key: BAGATI_ADMIN_2FA_KEY only (32 random bytes, base64 or 64 hex characters). It is deliberately NOT derived
 * from SESSION_SECRET and there is no fallback: when the key is missing or invalid, enrollment is disabled and
 * TOTP codes of already-enrolled admins cannot be checked (recovery codes still work, they do not use this key).
 *
 * Format: "v1.<iv>.<tag>.<ciphertext>" (base64url), AES-256-GCM with a random 96-bit IV. The user id is bound as
 * additional authenticated data, so a ciphertext copied to another user's row does not decrypt.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const ADMIN_2FA_KEY_ENV = "BAGATI_ADMIN_2FA_KEY";
const VERSION = "v1";

export type Admin2faKeyStatus = "configured" | "missing" | "invalid";
type Env = Record<string, string | undefined>;

export class Admin2faKeyError extends Error {
  constructor(readonly status: Exclude<Admin2faKeyStatus, "configured">) {
    super(status === "missing" ? `${ADMIN_2FA_KEY_ENV} is not set` : `${ADMIN_2FA_KEY_ENV} must encode exactly 32 bytes`);
    this.name = "Admin2faKeyError";
  }
}

function parseKey(env: Env): Buffer | Admin2faKeyStatus {
  const raw = env[ADMIN_2FA_KEY_ENV]?.trim();
  if (!raw) return "missing";
  // Refuse a copy of SESSION_SECRET: the key must be independent of session signing.
  if (env.SESSION_SECRET && raw === env.SESSION_SECRET.trim()) return "invalid";
  let key: Buffer;
  if (/^[0-9a-f]{64}$/i.test(raw)) key = Buffer.from(raw, "hex");
  else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)) key = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  else return "invalid";
  return key.length === 32 ? key : "invalid";
}

export function admin2faKeyStatus(env: Env = process.env): Admin2faKeyStatus {
  const parsed = parseKey(env);
  return Buffer.isBuffer(parsed) ? "configured" : parsed;
}

function requireKey(env: Env): Buffer {
  const parsed = parseKey(env);
  if (Buffer.isBuffer(parsed)) return parsed;
  throw new Admin2faKeyError(parsed === "configured" ? "invalid" : parsed);
}

function aad(userId: string) {
  return Buffer.from(`bagati-admin-2fa:${VERSION}:${userId}`, "utf8");
}

export function encryptTotpSecret(secret: Uint8Array, userId: string, env: Env = process.env): string {
  const key = requireKey(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(userId));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** Throws Admin2faKeyError when the key is unavailable, and a generic Error when the value was tampered with. */
export function decryptTotpSecret(value: string, userId: string, env: Env = process.env): Buffer {
  const key = requireKey(env);
  const [version, iv, tag, ciphertext, extra] = value.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext || extra !== undefined) throw new Error("Unsupported 2FA secret format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(aad(userId));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]);
}
