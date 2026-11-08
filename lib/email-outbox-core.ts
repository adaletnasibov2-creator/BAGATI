import { createHash } from "node:crypto";

export type OutboxInput = {
  eventKey: string;
  recipient: string;
  template: string;
  payload: Record<string, string | number | boolean | null>;
};

export function stableEmailDedupeKey(eventKey: string): string {
  return createHash("sha256").update(`BAGATI_EMAIL:${eventKey}`).digest("hex");
}

export function emailRetryDelayMs(attempt: number): number {
  return Math.min(60 * 60 * 1000, 15_000 * 2 ** Math.max(0, attempt - 1));
}

export function safeWorkerFailureCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return "UNKNOWN_ERROR_CODE";
  const allowed = new Set([
    "EAUTH",
    "ECONNECTION",
    "ETIMEDOUT",
    "ESOCKET",
    "ECONNREFUSED",
    "ENOTFOUND",
    "EDNS",
    "ETLS",
    "ECERT",
    "EENVELOPE",
    "EMESSAGE",
    "EPIPE",
    "P1000",
    "P1001",
    "P1002",
    "P1008",
    "P1017",
    "P2002",
    "P2024",
    "P2025",
    "WORKER_BATCH_FAILED",
    "WORKER_FAILED",
  ]);
  return allowed.has(error.code) ? error.code : "UNKNOWN_ERROR_CODE";
}

export function safeEmailFailureCode(error: unknown): string {
  if (!error || typeof error !== "object") return "DELIVERY_FAILED";
  if (error instanceof Error && error.name === "SmtpConfigurationError") return "SMTP_CONFIGURATION";
  const value = error as { code?: unknown; responseCode?: unknown };
  const allowed = new Set(["EAUTH", "ECONNECTION", "ETIMEDOUT", "ESOCKET", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN", "ENOTFOUND", "EDNS", "ETLS", "ECERT", "EENVELOPE", "EMESSAGE", "EPIPE", "SMTP_REJECTED", "SMTP_CONFIGURATION", "MESSAGE_NOT_ACCEPTED", "VERIFICATION_STALE", "INVALID_TEMPLATE", "EMAIL_PAYLOAD_INVALID", "EMAIL_PAYLOAD_DECRYPT_FAILED", "PASSWORD_RESET_STALE", "DELIVERY_RESULT_UNKNOWN"]);
  if (typeof value.code === "string" && allowed.has(value.code.toUpperCase())) return value.code.toUpperCase();
  if (typeof value.code === "string" && /^P\d{4}$/.test(value.code)) return `PRISMA_${value.code}`;
  if (typeof value.responseCode === "number" && Number.isInteger(value.responseCode)) return `SMTP_${value.responseCode}`;
  return "DELIVERY_FAILED";
}

export function safeEmailFailureType(error: unknown): string {
  if (!error || typeof error !== "object") return "UnknownError";
  const candidate = error as { name?: unknown; constructor?: { name?: unknown } };
  const allowed = new Set([
    "Error",
    "TypeError",
    "RangeError",
    "SyntaxError",
    "URIError",
    "PrismaClientKnownRequestError",
    "PrismaClientUnknownRequestError",
    "PrismaClientInitializationError",
    "PrismaClientValidationError",
    "PrismaClientRustPanicError",
    "SmtpConfigurationError",
  ]);
  if (typeof candidate.name === "string" && allowed.has(candidate.name)) return candidate.name;
  if (typeof candidate.constructor?.name === "string" && allowed.has(candidate.constructor.name)) return candidate.constructor.name;
  return "UnknownError";
}

export const EMAIL_FAILURE_CATEGORIES = [
  "DNS_FAILURE",
  "CONNECTION_TIMEOUT",
  "CONNECTION_REFUSED",
  "CONNECTION_RESET",
  "NETWORK_ERROR",
  "TLS_FAILURE",
  "SMTP_TEMPORARY",
  "SMTP_PERMANENT",
  "SMTP_AUTHENTICATION",
  "SMTP_CONFIGURATION",
  "PAYLOAD_DECRYPTION",
  "MESSAGE_REJECTED",
  "UNKNOWN",
] as const;

export type EmailFailureCategory = typeof EMAIL_FAILURE_CATEGORIES[number];

export type EmailFailureDiagnosis = {
  category: EmailFailureCategory;
  smtpCodeClass: "4xx" | "5xx" | null;
  diagnosticCode: string;
  retryable: boolean;
};

// Nodemailer sets EHLO, STARTTLS, MAIL FROM, RCPT TO, and VERIFY only before the
// message body. DATA is the body. CONN is used for ESOCKET, ETIMEDOUT, and
// ECONNECTION both before and during DATA, so that combination does not prove
// the message was unsent. An empty command does not prove either stage.
const CONNECT_COMMANDS = new Set(["CONN", "EHLO", "STARTTLS", "MAIL FROM", "RCPT TO", "VERIFY"]);
const AMBIGUOUS_CONN_CODES = new Set(["ESOCKET", "ETIMEDOUT", "ECONNECTION"]);
const BEFORE_DATA_COMMANDS = new Set(["EHLO", "STARTTLS", "MAIL FROM", "RCPT TO", "VERIFY"]);
const PERMANENT_TLS_CODES = new Set(["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "ECERT"]);
const MESSAGE_REJECTION_CODES = new Set(["EMAIL_PAYLOAD_INVALID", "INVALID_TEMPLATE", "VERIFICATION_STALE", "PASSWORD_RESET_STALE", "MESSAGE_NOT_ACCEPTED", "DELIVERY_RESULT_UNKNOWN"]);

function smtpCodeClass(responseCode: number | undefined): "4xx" | "5xx" | null {
  if (responseCode === undefined) return null;
  if (responseCode >= 400 && responseCode < 500) return "4xx";
  if (responseCode >= 500 && responseCode < 600) return "5xx";
  return null;
}

function deliveryErrorShape(error: unknown) {
  if (!error || typeof error !== "object") return { code: "", command: "", responseCode: undefined as number | undefined, name: "", permanentTls: false };
  const value = error as { code?: unknown; command?: unknown; responseCode?: unknown; authorizationError?: unknown };
  const allowedCodes = new Set(["EAUTH", "ECONNECTION", "ETIMEDOUT", "ESOCKET", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN", "ENOTFOUND", "EDNS", "ETLS", "ECERT", "EENVELOPE", "EMESSAGE", "EPIPE", "SMTP_REJECTED", "SMTP_CONFIGURATION", "MESSAGE_NOT_ACCEPTED", "VERIFICATION_STALE", "INVALID_TEMPLATE", "EMAIL_PAYLOAD_INVALID", "EMAIL_PAYLOAD_DECRYPT_FAILED", "PASSWORD_RESET_STALE", "DELIVERY_RESULT_UNKNOWN"]);
  const allowedCommands = new Set(["AUTH", "CONN", "EHLO", "STARTTLS", "MAIL FROM", "RCPT TO", "DATA", "QUIT", "VERIFY"]);
  const rawCode = typeof value.code === "string" ? value.code.toUpperCase() : "";
  const code = allowedCodes.has(rawCode) ? rawCode : "";
  const command = typeof value.command === "string" && allowedCommands.has(value.command.toUpperCase()) ? value.command.toUpperCase() : "";
  const responseCode = typeof value.responseCode === "number" && Number.isInteger(value.responseCode) ? value.responseCode : undefined;
  const name = error instanceof Error && error.name === "SmtpConfigurationError" ? error.name : "";
  const authorizationError = typeof value.authorizationError === "string" ? value.authorizationError : "";
  const permanentTls = PERMANENT_TLS_CODES.has(rawCode) || PERMANENT_TLS_CODES.has(authorizationError);
  return { code, command, responseCode, name, permanentTls };
}

/** Maps an error to allowlisted diagnostics. The original message is never copied. */
export function diagnoseEmailDeliveryFailure(error: unknown): EmailFailureDiagnosis {
  const shape = deliveryErrorShape(error);
  const diagnosticCode = safeEmailFailureCode(error);
  const connectStage = CONNECT_COMMANDS.has(shape.command);
  const beforeData = BEFORE_DATA_COMMANDS.has(shape.command);
  const diagnosis = (category: EmailFailureCategory, retryable: boolean): EmailFailureDiagnosis => ({
    category,
    smtpCodeClass: smtpCodeClass(shape.responseCode),
    diagnosticCode,
    retryable,
  });

  if (shape.name === "SmtpConfigurationError" || shape.code === "SMTP_CONFIGURATION") return diagnosis("SMTP_CONFIGURATION", false);
  if (shape.code === "EMAIL_PAYLOAD_DECRYPT_FAILED") return diagnosis("PAYLOAD_DECRYPTION", false);
  if (MESSAGE_REJECTION_CODES.has(shape.code)) return diagnosis("MESSAGE_REJECTED", false);
  if (shape.code === "EAUTH" || shape.command === "AUTH" || shape.responseCode === 535) return diagnosis("SMTP_AUTHENTICATION", false);
  // An explicit temporary SMTP reply, including 454 during STARTTLS, is not a certificate failure.
  if (shape.responseCode !== undefined && shape.responseCode >= 400 && shape.responseCode < 500) return diagnosis("SMTP_TEMPORARY", true);
  if ((shape.responseCode !== undefined && shape.responseCode >= 500 && shape.responseCode < 600) || shape.code === "EENVELOPE") return diagnosis("SMTP_PERMANENT", false);
  if (shape.permanentTls || shape.code === "ECERT") return diagnosis("TLS_FAILURE", false);
  // This Nodemailer build labels socket, timeout, and connection failures as CONN
  // even after DATA has started. Acceptance is unknown, so the attempt is terminal.
  if (AMBIGUOUS_CONN_CODES.has(shape.code) && shape.command === "CONN") {
    return { category: "UNKNOWN", smtpCodeClass: null, diagnosticCode: "DELIVERY_RESULT_UNKNOWN", retryable: false };
  }
  // ETLS on CONN or STARTTLS is this Nodemailer build's pre-DATA handshake failure.
  // The same code without one of those commands has no safe stage, so it is not retried.
  if (shape.code === "ETLS" || (shape.code === "ESOCKET" && shape.command === "STARTTLS")) return diagnosis("TLS_FAILURE", shape.code === "ETLS" && (shape.command === "CONN" || shape.command === "STARTTLS"));
  if (shape.code === "EAI_AGAIN" || shape.code === "ENOTFOUND" || shape.code === "EDNS") return diagnosis("DNS_FAILURE", connectStage);
  if (shape.code === "ETIMEDOUT") return diagnosis("CONNECTION_TIMEOUT", connectStage);
  if (shape.code === "ECONNREFUSED") return diagnosis("CONNECTION_REFUSED", connectStage);
  // CONN is also used for socket errors after DATA has started, so reset and pipe retry only on commands that exist before the body.
  if (shape.code === "ECONNRESET" || shape.code === "EPIPE") return diagnosis("CONNECTION_RESET", beforeData);
  if (shape.code === "ECONNECTION" || shape.code === "ESOCKET") return diagnosis("NETWORK_ERROR", connectStage);
  return diagnosis("UNKNOWN", false);
}

export function isSafeEmailRetry(error: unknown): boolean {
  return diagnoseEmailDeliveryFailure(error).retryable;
}
