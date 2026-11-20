/**
 * Optional extra notification email per store (SELLER-ALERTS, part B).
 *
 * - Saved lower-cased and UNVERIFIED; a single-use link is sent to that address. Only a verified address receives
 *   new-order emails (lib/seller-order-emails.ts). Changing the address clears the verification; removing it clears both.
 * - Token: 32 random bytes (base64url) in the link, only its SHA-256 hash in the database, valid 24 hours, single use.
 *   A token verifies only while the store still has exactly the address it was sent to. Saving a new address or
 *   resending marks every earlier unused token of the store as used.
 * - The link carries the token in the URL fragment (#token=...), like the password reset: it never reaches server
 *   logs or Referer headers; the page posts it to /api/store-notification-email/verify.
 * - The seller's account email always keeps receiving new-order emails, independent of this address.
 * Sending is limited by the caller (API route) to NOTIFICATION_EMAIL_SEND_LIMIT per hour per store.
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { absoluteSiteUrl } from "@/lib/category-seo";
import { enqueueEmail } from "@/lib/email-outbox";

export const NOTIFICATION_EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const NOTIFICATION_EMAIL_SEND_LIMIT = { limit: 3, windowMs: 60 * 60 * 1000 } as const;
export const NOTIFICATION_EMAIL_VERIFY_PATH = "/vendor/notification-email/verify";

const emailSchema = z.string().trim().email().max(254);

/** Trimmed, lower-cased, valid address, or null. */
export function normalizeNotificationEmail(input: unknown): string | null {
  const parsed = emailSchema.safeParse(input);
  return parsed.success ? parsed.data.toLowerCase() : null;
}

export function hashNotificationEmailToken(token: string): string {
  return createHash("sha256").update(`BAGATI_STORE_NOTIFICATION_EMAIL_V1:${token}`).digest("hex");
}

export function createNotificationEmailToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashNotificationEmailToken(token) };
}

/** The link in the verification email; null without a valid APP_BASE_URL (nothing is queued then). */
export function notificationEmailVerifyUrl(token: string, base: string | undefined = process.env.APP_BASE_URL): string | null {
  const page = absoluteSiteUrl(NOTIFICATION_EMAIL_VERIFY_PATH, base);
  return page ? `${page}#token=${encodeURIComponent(token)}` : null;
}

export type NotificationEmailStatus = { email: string | null; verified: boolean };
export function notificationEmailStatus(store: { notificationEmail: string | null; notificationEmailVerifiedAt: Date | null }): NotificationEmailStatus {
  return { email: store.notificationEmail, verified: Boolean(store.notificationEmail && store.notificationEmailVerifiedAt) };
}

type Db = Pick<PrismaClient, "$transaction">;
type Tx = Prisma.TransactionClient;

async function issueToken(tx: Tx, input: { storeId: string; storeName: string; email: string; now: Date }) {
  await tx.storeNotificationEmailToken.updateMany({ where: { storeId: input.storeId, usedAt: null }, data: { usedAt: input.now } });
  const { token, tokenHash } = createNotificationEmailToken();
  const verifyUrl = notificationEmailVerifyUrl(token);
  if (!verifyUrl) throw Object.assign(new Error("APP_BASE_URL is required for the verification link."), { code: "BASE_URL_MISSING" });
  await tx.storeNotificationEmailToken.create({ data: { storeId: input.storeId, email: input.email, tokenHash, expiresAt: new Date(input.now.getTime() + NOTIFICATION_EMAIL_TOKEN_TTL_MS) } });
  await enqueueEmail(tx, { eventKey: `store-notification-email-verify:${input.storeId}:${tokenHash}`, recipient: input.email, template: "STORE_NOTIFICATION_EMAIL_VERIFY", payload: { storeName: input.storeName, verifyUrl } });
}

/**
 * Saves the address. A new or changed address is stored unverified and gets a link (sent = true). Saving the same,
 * already verified address changes nothing (sent = false).
 */
export async function saveNotificationEmail(db: Db, input: { storeId: string; email: string; now?: Date }): Promise<NotificationEmailStatus & { sent: boolean }> {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    const store = await tx.store.findUniqueOrThrow({ where: { id: input.storeId }, select: { name: true, notificationEmail: true, notificationEmailVerifiedAt: true } });
    if (store.notificationEmail === input.email && store.notificationEmailVerifiedAt) return { ...notificationEmailStatus(store), sent: false };
    const updated = await tx.store.update({ where: { id: input.storeId }, data: { notificationEmail: input.email, notificationEmailVerifiedAt: null }, select: { notificationEmail: true, notificationEmailVerifiedAt: true } });
    await issueToken(tx, { storeId: input.storeId, storeName: store.name, email: input.email, now });
    return { ...notificationEmailStatus(updated), sent: true };
  });
}

/** Sends a fresh link for the saved, still unverified address. */
export async function resendNotificationEmail(db: Db, input: { storeId: string; now?: Date }): Promise<NotificationEmailStatus & { sent: boolean }> {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    const store = await tx.store.findUniqueOrThrow({ where: { id: input.storeId }, select: { name: true, notificationEmail: true, notificationEmailVerifiedAt: true } });
    if (!store.notificationEmail || store.notificationEmailVerifiedAt) return { ...notificationEmailStatus(store), sent: false };
    await issueToken(tx, { storeId: input.storeId, storeName: store.name, email: store.notificationEmail, now });
    return { ...notificationEmailStatus(store), sent: true };
  });
}

export async function removeNotificationEmail(db: Db, input: { storeId: string; now?: Date }): Promise<NotificationEmailStatus> {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    await tx.storeNotificationEmailToken.updateMany({ where: { storeId: input.storeId, usedAt: null }, data: { usedAt: now } });
    const store = await tx.store.update({ where: { id: input.storeId }, data: { notificationEmail: null, notificationEmailVerifiedAt: null }, select: { notificationEmail: true, notificationEmailVerifiedAt: true } });
    return notificationEmailStatus(store);
  });
}

/**
 * Uses a token: marks it used and the store's address verified, atomically. false for an unknown, used or expired
 * token, or when the store's address changed since the link was sent.
 */
export async function verifyNotificationEmailToken(db: Db, token: string, now: Date = new Date()): Promise<boolean> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return false;
  const tokenHash = hashNotificationEmailToken(token);
  return db.$transaction(async (tx) => {
    const row = await tx.storeNotificationEmailToken.findUnique({ where: { tokenHash }, select: { id: true, storeId: true, email: true, usedAt: true, expiresAt: true } });
    if (!row || row.usedAt || row.expiresAt <= now) return false;
    const claimed = await tx.storeNotificationEmailToken.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (claimed.count !== 1) return false;
    const verified = await tx.store.updateMany({ where: { id: row.storeId, notificationEmail: row.email }, data: { notificationEmailVerifiedAt: now } });
    return verified.count === 1;
  });
}
