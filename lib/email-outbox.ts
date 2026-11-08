import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { stableEmailDedupeKey, type OutboxInput } from "@/lib/email-outbox-core";

type OutboxWriter = Pick<PrismaClient, "emailOutbox"> | Prisma.TransactionClient;

function encryptionKey(): Buffer {
  const configured = process.env.EMAIL_ENCRYPTION_KEY?.trim();
  if (configured) {
    const key = /^[a-f0-9]{64}$/i.test(configured) ? Buffer.from(configured, "hex") : Buffer.from(configured, "base64");
    if (key.length !== 32) throw new Error("EMAIL_ENCRYPTION_KEY must encode exactly 32 bytes.");
    return key;
  }
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) throw new Error("SESSION_SECRET or EMAIL_ENCRYPTION_KEY is required for email encryption.");
  return createHmac("sha256", sessionSecret).update("BAGATI_EMAIL_OUTBOX_ENCRYPTION_V1").digest();
}

export function isEmailPayloadEncryptionConfigured(): boolean {
  try { encryptionKey(); return true; } catch { return false; }
}

/** Reports which key is active. Never returns the key itself. */
export function emailPayloadEncryptionMode(): "dedicated" | "session-fallback" | "missing" {
  if (process.env.EMAIL_ENCRYPTION_KEY?.trim()) {
    try { encryptionKey(); return "dedicated"; } catch { return "missing"; }
  }
  try { encryptionKey(); return "session-fallback"; } catch { return "missing"; }
}

export function encryptEmailSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptEmailSecret(value: string): string {
  const [ivValue, tagValue, ciphertextValue] = value.split(".");
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error("Invalid encrypted email payload.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
}

export async function enqueueEmail(client: OutboxWriter, input: OutboxInput): Promise<void> {
  const dedupeKey = stableEmailDedupeKey(input.eventKey);
  await client.emailOutbox.upsert({
    where: { dedupeKey },
    create: { dedupeKey, recipient: input.recipient, template: input.template, payload: { encrypted: encryptEmailSecret(JSON.stringify(input.payload)) } as Prisma.InputJsonValue },
    update: {},
    select: { id: true },
  });
}

export async function enqueueVerificationEmail(client: OutboxWriter, input: { userId: string; recipient: string; codeHash: string; code: string; expiresAt: Date }): Promise<void> {
  await enqueueEmail(client, {
    eventKey: `email-verification:${input.userId}:${input.codeHash}`,
    recipient: input.recipient,
    template: "EMAIL_VERIFICATION",
    payload: { userId: input.userId, codeHash: input.codeHash, encryptedCode: encryptEmailSecret(input.code), expiresAt: input.expiresAt.toISOString() },
  });
}
