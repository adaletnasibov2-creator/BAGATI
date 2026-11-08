import { prisma } from "@/lib/prisma";
import { Prisma, type PrismaClient } from "@prisma/client";
import { classifySmtpFailure, getSmtpConfiguration, safeSmtpErrorMetadata, sendTransactionalEmail } from "@/lib/email";
import { EMAIL_TEMPLATES, type EmailPayload, type EmailTemplate } from "@/lib/email-templates";
import { diagnoseEmailDeliveryFailure, emailRetryDelayMs, safeEmailFailureType, type EmailFailureDiagnosis } from "@/lib/email-outbox-core";
import { decryptEmailSecret } from "@/lib/email-outbox";

const MAX_ATTEMPTS = 5;
const STALE_LOCK_MS = 15 * 60 * 1000;

type EmailWorkerDependencies = {
  prisma: Pick<PrismaClient, "emailOutbox" | "emailVerification" | "user" | "$queryRaw">;
  assertSmtpConfigured: () => void;
  sendTransactionalEmail: typeof sendTransactionalEmail;
};

const DIAGNOSTIC_FIELDS = ["failureCategory", "smtpCodeClass", "failedAt"] as const;
const DIAGNOSTIC_FIELD_NAMES = new Set<string>(DIAGNOSTIC_FIELDS);

function diagnosticColumnName(identifier: string) {
  const segment = identifier.split(".").at(-1) ?? "";
  return DIAGNOSTIC_FIELD_NAMES.has(segment) ? segment : "";
}

export function isMissingDiagnosticColumn(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; name?: unknown; message?: unknown; meta?: { column?: unknown } };
  if (candidate.code === "P2022") {
    // Prisma 6 puts the missing column in meta.column as "failureCategory",
    // "EmailOutbox.failureCategory", or "public.EmailOutbox.failureCategory".
    return typeof candidate.meta?.column === "string" && diagnosticColumnName(candidate.meta.column) !== "";
  }
  if (candidate.name !== "PrismaClientValidationError" || typeof candidate.message !== "string") return false;
  const plain = candidate.message.replace(/\u001b\[[0-9;]*m/g, "");
  const unknownArgument = plain.match(/Unknown argument `([^`]+)`/);
  return unknownArgument !== null && DIAGNOSTIC_FIELD_NAMES.has(unknownArgument[1]);
}

function withoutDiagnosticFields<T extends Record<string, unknown>>(data: T) {
  const copy = { ...data };
  for (const field of DIAGNOSTIC_FIELDS) delete copy[field];
  return copy;
}

function failureDiagnostics(diagnosis: EmailFailureDiagnosis, failedAt: Date) {
  return {
    failureCategory: diagnosis.category,
    smtpCodeClass: diagnosis.smtpCodeClass,
    failedAt,
  };
}

const clearedFailureDiagnostics = { failureCategory: null, smtpCodeClass: null, failedAt: null };

async function updateOutboxRow(database: EmailWorkerDependencies["prisma"], where: { id: string }, data: Record<string, unknown>) {
  try {
    await database.emailOutbox.update({ where, data: data as never });
  } catch (error) {
    if (!isMissingDiagnosticColumn(error)) throw error;
    await database.emailOutbox.update({ where, data: withoutDiagnosticFields(data) as never });
  }
}

async function updateOutboxRows(database: EmailWorkerDependencies["prisma"], where: Record<string, unknown>, data: Record<string, unknown>) {
  try {
    return await database.emailOutbox.updateMany({ where: where as never, data: data as never });
  } catch (error) {
    if (!isMissingDiagnosticColumn(error)) throw error;
    return await database.emailOutbox.updateMany({ where: where as never, data: withoutDiagnosticFields(data) as never });
  }
}

export async function requeueRetrySafeOutbox(database: Pick<EmailWorkerDependencies["prisma"], "emailOutbox">, id: string) {
  return updateOutboxRows(database as EmailWorkerDependencies["prisma"], { id, status: "FAILED", retrySafe: true }, {
    status: "PENDING",
    availableAt: new Date(),
    lockedAt: null,
    lastErrorCode: null,
    retrySafe: false,
    ...clearedFailureDiagnostics,
  });
}

const defaultDependencies: EmailWorkerDependencies = {
  prisma,
  assertSmtpConfigured: getSmtpConfiguration,
  sendTransactionalEmail,
};

function plainPayload(value: unknown): EmailPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("Invalid email payload."), { code: "EMAIL_PAYLOAD_INVALID" });
  const encrypted = (value as Record<string, unknown>).encrypted;
  if (typeof encrypted !== "string") throw Object.assign(new Error("Invalid email payload."), { code: "EMAIL_PAYLOAD_INVALID" });
  let plaintext: string;
  try {
    plaintext = decryptEmailSecret(encrypted);
  } catch {
    throw Object.assign(new Error("Email payload decryption failed."), { code: "EMAIL_PAYLOAD_DECRYPT_FAILED" });
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(plaintext);
  } catch {
    throw Object.assign(new Error("Invalid email payload."), { code: "EMAIL_PAYLOAD_INVALID" });
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw Object.assign(new Error("Invalid email payload."), { code: "EMAIL_PAYLOAD_INVALID" });
  const result: EmailPayload = {};
  for (const [key, item] of Object.entries(decoded)) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null) result[key] = item;
  }
  return result;
}

export async function processEmailOutboxBatch(
  batchSize = 25,
  dependencies: EmailWorkerDependencies = defaultDependencies,
  targetOutboxId?: string,
) {
  const { prisma: database, assertSmtpConfigured, sendTransactionalEmail: deliver } = dependencies;
  assertSmtpConfigured();
  const now = new Date();
  await updateOutboxRows(database, {
    ...(targetOutboxId ? { id: targetOutboxId } : {}),
    status: "PROCESSING",
    lockedAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) },
  }, { status: "FAILED", lockedAt: null, retrySafe: false, lastErrorCode: "DELIVERY_RESULT_UNKNOWN", failureCategory: "UNKNOWN", smtpCodeClass: null, failedAt: now });
  const pending = await database.emailOutbox.findMany({
    where: {
      ...(targetOutboxId ? { id: targetOutboxId } : {}),
      status: "PENDING",
      availableAt: { lte: now },
    },
    orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }], take: Math.max(1, Math.min(batchSize, 100)),
  });
  let sent = 0;
  let failed = 0;
  for (const candidate of pending) {
    const claimed = await updateOutboxRows(database, { id: candidate.id, status: "PENDING" }, {
      status: "PROCESSING", lockedAt: new Date(), attempts: { increment: 1 }, lastErrorCode: null, retrySafe: false, ...clearedFailureDiagnostics,
    });
    if (claimed.count !== 1) continue;
    const attempt = candidate.attempts + 1;
    let failureStage = "validate_template";
    const logTemplate = EMAIL_TEMPLATES.includes(candidate.template as EmailTemplate) ? candidate.template : "UNKNOWN_TEMPLATE";
    try {
      if (!EMAIL_TEMPLATES.includes(candidate.template as EmailTemplate)) throw Object.assign(new Error("Unknown template."), { code: "INVALID_TEMPLATE" });
      failureStage = "decode_payload";
      let payload = plainPayload(candidate.payload);
      if (candidate.template === "EMAIL_VERIFICATION") {
        failureStage = "validate_verification";
        const userId = String(payload.userId ?? "");
        const verification = await database.emailVerification.findUnique({ where: { userId }, select: { codeHash: true, expiresAt: true, attempts: true } });
        const user = await database.user.findFirst({ where: { id: userId, email: candidate.recipient, isActive: true, emailVerifiedAt: null }, select: { id: true } });
        const expiresAt = new Date(String(payload.expiresAt ?? ""));
        if (!verification || !user || verification.codeHash !== payload.codeHash || verification.expiresAt <= new Date() || verification.attempts >= 5 || expiresAt <= new Date()) {
          throw Object.assign(new Error("Verification is no longer valid."), { code: "VERIFICATION_STALE" });
        }
        payload = { code: decryptEmailSecret(String(payload.encryptedCode ?? "")) };
      }
      if (candidate.template === "PASSWORD_RESET") {
        failureStage = "validate_password_reset";
        const tokenHash = String(payload.tokenHash ?? "");
        const resetRows = await database.$queryRaw<Array<{ userId: string; expiresAt: Date; usedAt: Date | null }>>(Prisma.sql`
          SELECT "userId", "expiresAt", "usedAt"
          FROM "PasswordResetToken" WHERE "tokenHash" = ${tokenHash} LIMIT 1
        `);
        const reset = resetRows[0];
        const user = reset ? await database.user.findFirst({
          where: { id: reset.userId, email: candidate.recipient, isActive: true },
          select: { id: true },
        }) : null;
        const expiresAt = new Date(String(payload.expiresAt ?? ""));
        if (!reset || !user || reset.usedAt !== null || reset.expiresAt <= new Date() || expiresAt <= new Date()) {
          throw Object.assign(new Error("Password reset is no longer valid."), { code: "PASSWORD_RESET_STALE" });
        }
      }
      failureStage = "smtp_send";
      await deliver(candidate.template as EmailTemplate, payload, candidate.recipient, candidate.dedupeKey);
      failureStage = "persist_sent";
      await updateOutboxRow(database, { id: candidate.id }, { status: "SENT", sentAt: new Date(), lockedAt: null, lastErrorCode: null, retrySafe: false, ...clearedFailureDiagnostics });
      sent++;
    } catch (error) {
      if (failureStage === "persist_sent") {
        // SMTP already accepted the message. Leave the claimed PROCESSING row untouched
        // so the 15-minute stale-lock path can record DELIVERY_RESULT_UNKNOWN without another send.
        console.error("Email outbox acceptance was not recorded.", {
          outboxId: candidate.id,
          template: logTemplate,
          stage: "persist_sent",
          failureCode: "DELIVERY_RESULT_UNKNOWN",
        });
        throw Object.assign(new Error("Delivery result was not recorded."), { code: "DELIVERY_RESULT_UNKNOWN" });
      }
      const diagnosis = diagnoseEmailDeliveryFailure(error);
      const retrySafe = diagnosis.retryable && attempt < MAX_ATTEMPTS;
      const retryDelayMs = retrySafe ? emailRetryDelayMs(attempt) : 0;
      const smtpMetadata = safeSmtpErrorMetadata(error);
      // Log only allowlisted SMTP metadata. Never include recipients, payloads,
      // verification codes, provider response text, or raw error objects.
      console.error("Email outbox delivery failed.", {
        outboxId: candidate.id,
        template: logTemplate,
        stage: failureStage,
        failureCode: diagnosis.diagnosticCode,
        failureType: safeEmailFailureType(error),
        failureCategory: classifySmtpFailure(smtpMetadata),
        diagnosticCategory: diagnosis.category,
        smtpCodeClass: diagnosis.smtpCodeClass,
        retryDecision: retrySafe ? "retry" : "terminal",
        retryDelayMs,
        smtp: smtpMetadata,
      });
      await updateOutboxRow(database, { id: candidate.id }, {
        status: retrySafe ? "PENDING" : "FAILED",
        lockedAt: null,
        availableAt: retrySafe ? new Date(Date.now() + retryDelayMs) : candidate.availableAt,
        retrySafe,
        lastErrorCode: diagnosis.diagnosticCode,
        ...failureDiagnostics(diagnosis, new Date()),
      });
      failed++;
    }
  }
  return { processed: sent + failed, sent, failed };
}
