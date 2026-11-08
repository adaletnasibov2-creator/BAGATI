import { createHash, randomBytes } from "node:crypto";

export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

export function generatePasswordResetToken() {
  return randomBytes(32).toString("base64url");
}

export function hashPasswordResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function passwordResetTokenIsUsable(input: { expiresAt: Date; usedAt: Date | null }, now = new Date()) {
  return input.usedAt === null && input.expiresAt.getTime() > now.getTime();
}

export function getPublicAppUrl(value = process.env.APP_BASE_URL, production = process.env.NODE_ENV === "production") {
  if (!value?.trim()) throw new Error("APP_BASE_URL must be configured for account recovery links.");
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("APP_BASE_URL must be an origin without credentials, path, query, or fragment.");
  }
  if (production && url.protocol !== "https:") {
    throw new Error("APP_BASE_URL must use HTTPS in production.");
  }
  if (url.protocol !== "https:" && !(!production && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("APP_BASE_URL must use HTTPS, except for local development.");
  }
  return url.origin;
}
