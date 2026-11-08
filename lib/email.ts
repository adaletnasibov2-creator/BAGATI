import nodemailer, { type SendMailOptions } from "nodemailer";
import tls from "node:tls";
import { buildTransactionalEmail, type EmailPayload, type EmailTemplate } from "@/lib/email-templates";
import { stableEmailDedupeKey } from "@/lib/email-outbox-core";

type SmtpConfiguration = {
  host: string;
  port: 465 | 587;
  user: string;
  password: string;
  from: string;
};

export class SmtpConfigurationError extends Error {
  constructor() {
    super("SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD və SMTP_FROM konfiqurasiya edilməlidir.");
    this.name = "SmtpConfigurationError";
  }
}

export function getSmtpConfiguration(): SmtpConfiguration {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;
  const port = Number(SMTP_PORT);
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM || (port !== 465 && port !== 587)) {
    throw new SmtpConfigurationError();
  }
  return { host: SMTP_HOST, port, user: SMTP_USER, password: SMTP_PASSWORD, from: SMTP_FROM };
}

export function assertEmailDeliveryConfigured() {
  getSmtpConfiguration();
}

export function smtpTlsOptions(port: SmtpConfiguration["port"]) {
  return {
    secure: port === 465,
    ...(port === 587 ? { requireTLS: true } : {}),
  };
}

let smtpTrustedCertificates: string[] | undefined;

function getSmtpTrustedCertificates() {
  if (!smtpTrustedCertificates) {
    // Include OS-installed roots because NODE_USE_SYSTEM_CA must otherwise be set before Node starts.
    smtpTrustedCertificates = Array.from(new Set([
      ...tls.getCACertificates("default"),
      ...tls.getCACertificates("system"),
    ]));
  }
  return smtpTrustedCertificates;
}

export function createSmtpTransport(config = getSmtpConfiguration(), connectionTimeout?: number) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    ...smtpTlsOptions(config.port),
    ...(connectionTimeout ? {
      connectionTimeout,
      greetingTimeout: connectionTimeout,
      socketTimeout: connectionTimeout,
    } : {}),
    tls: { ca: getSmtpTrustedCertificates() },
    auth: { user: config.user, pass: config.password },
  });
}

type SmtpErrorMetadata = {
  code?: string;
  command?: string;
  responseCode?: number;
  syscall?: string;
  address?: string;
  port?: number;
  family?: number;
  tlsAuthorizationError?: string;
  cause?: SmtpErrorMetadata;
};

export type SmtpFailureCategory = "authentication" | "tls" | "connection" | "timeout" | "sender_rejected" | "recipient_rejected" | "provider_rejected" | "unknown";

export function safeSmtpErrorMetadata(error: unknown): SmtpErrorMetadata {
  if (!error || typeof error !== "object") return {};
  const candidate = error as {
    code?: unknown;
    command?: unknown;
    responseCode?: unknown;
    syscall?: unknown;
    address?: unknown;
    port?: unknown;
    family?: unknown;
    authorizationError?: unknown;
    cause?: unknown;
  };
  const safeCodes = new Set(["EAUTH", "ECONNECTION", "ETIMEDOUT", "ESOCKET", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN", "ENOTFOUND", "EDNS", "ETLS", "ECERT", "EENVELOPE", "EMESSAGE", "EPIPE"]);
  const code = typeof candidate.code === "string" && safeCodes.has(candidate.code.toUpperCase()) ? candidate.code.toUpperCase() : undefined;
  const responseCode = typeof candidate.responseCode === "number" && Number.isInteger(candidate.responseCode) ? candidate.responseCode : undefined;
  const allowedCommands = new Set(["AUTH", "CONN", "EHLO", "STARTTLS", "MAIL FROM", "RCPT TO", "DATA", "QUIT", "VERIFY"]);
  const command = typeof candidate.command === "string" && allowedCommands.has(candidate.command.toUpperCase())
    ? candidate.command.toUpperCase()
    : undefined;
  const allowedSyscalls = new Set(["connect", "getaddrinfo", "lookup", "read", "write"]);
  const syscall = typeof candidate.syscall === "string" && allowedSyscalls.has(candidate.syscall.toLowerCase())
    ? candidate.syscall.toLowerCase()
    : undefined;
  const address = typeof candidate.address === "string" && /^[0-9a-f:.]{2,64}$/i.test(candidate.address) ? candidate.address : undefined;
  const port = typeof candidate.port === "number" && Number.isInteger(candidate.port) ? candidate.port : undefined;
  const family = typeof candidate.family === "number" && (candidate.family === 4 || candidate.family === 6) ? candidate.family : undefined;
  const allowedTlsErrors = new Set(["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID"]);
  const tlsAuthorizationError = typeof candidate.authorizationError === "string" && allowedTlsErrors.has(candidate.authorizationError)
    ? candidate.authorizationError
    : undefined;
  const cause: SmtpErrorMetadata | undefined = candidate.cause && typeof candidate.cause === "object"
    ? safeSmtpErrorMetadata(candidate.cause)
    : undefined;
  return {
    ...(code ? { code } : {}),
    ...(command ? { command } : {}),
    ...(responseCode ? { responseCode } : {}),
    ...(syscall ? { syscall } : {}),
    ...(address ? { address } : {}),
    ...(port ? { port } : {}),
    ...(family ? { family } : {}),
    ...(tlsAuthorizationError ? { tlsAuthorizationError } : {}),
    ...(cause && Object.keys(cause).length ? { cause } : {}),
  };
}

export function classifySmtpFailure(metadata: SmtpErrorMetadata): SmtpFailureCategory {
  const code = metadata.code?.toUpperCase();
  const command = metadata.command?.toUpperCase();
  if (code === "EAUTH" || command === "AUTH" || metadata.responseCode === 535) return "authentication";
  if (metadata.tlsAuthorizationError || metadata.cause?.tlsAuthorizationError || code === "ETLS" || (code === "ESOCKET" && command === "STARTTLS")) return "tls";
  if (code === "ETIMEDOUT") return "timeout";
  if (command === "MAIL FROM") return "sender_rejected";
  if (command === "RCPT TO") return "recipient_rejected";
  if (["ECONNECTION", "ECONNREFUSED", "ENOTFOUND", "EDNS"].includes(code ?? "") || (code === "ESOCKET" && command === "CONN")) return "connection";
  if (typeof metadata.responseCode === "number" && metadata.responseCode >= 400) return "provider_rejected";
  return "unknown";
}

export function buildVerificationEmail(from: string, to: string, code: string): SendMailOptions {
  if (!/^\d{6}$/.test(code)) throw new Error("Verification email requires a six-digit code.");
  return {
    from,
    to,
    subject: "BAGATI — Email təsdiq kodunuz",
    text: `BAGATI hesabınızı təsdiqləmək üçün kod: ${code}\n\nKod 10 dəqiqə ərzində qüvvədədir. Təhlükəsizliyiniz üçün bu kodu heç kimlə paylaşmayın.`,
    html: `<!doctype html><html lang="az"><body style="margin:0;background:#f7f5ef;font-family:Arial,sans-serif;color:#16202c"><div style="max-width:560px;margin:32px auto;padding:32px;background:#fff;border:1px solid #e8e7e2;border-radius:20px"><p style="margin:0;color:#9a701e;font-size:12px;font-weight:bold;letter-spacing:3px">BAGATI</p><h1 style="font-size:24px;margin:24px 0 12px">Email ünvanınızı təsdiqləyin</h1><p style="font-size:15px;line-height:1.6">Hesabınızı təsdiqləmək üçün bu 6 rəqəmli kodu daxil edin:</p><p style="margin:24px 0;padding:18px;text-align:center;border-radius:12px;background:#f7f5ef;color:#0b1726;font-size:32px;font-weight:bold;letter-spacing:8px">${code}</p><p style="font-size:14px;line-height:1.6">Kod 10 dəqiqə ərzində qüvvədədir. Təhlükəsizliyiniz üçün bu kodu heç kimlə paylaşmayın.</p></div></body></html>`,
  };
}

type VerificationTransport = Pick<ReturnType<typeof nodemailer.createTransport>, "sendMail">;
type TransactionalTransport = Pick<ReturnType<typeof nodemailer.createTransport>, "sendMail" | "close">;
type VerificationTransportFactory = (config: SmtpConfiguration) => VerificationTransport;
type TransactionalTransportFactory = (config: SmtpConfiguration) => TransactionalTransport;
type SmtpCheckTransport = Pick<ReturnType<typeof nodemailer.createTransport>, "verify" | "close">;
type SmtpCheckTransportFactory = (config: SmtpConfiguration) => SmtpCheckTransport;

export async function sendVerificationEmail(
  to: string,
  code: string,
  transportFactory: VerificationTransportFactory = createSmtpTransport,
) {
  const config = getSmtpConfiguration();
  const transporter = transportFactory(config);
  await transporter.sendMail(buildVerificationEmail(config.from, to, code));
}

function acceptedRecipientMatches(result: unknown, recipient: string) {
  if (!result || typeof result !== "object" || !("accepted" in result) || !Array.isArray(result.accepted)) return false;
  return result.accepted.some((accepted: unknown) => {
    const address = typeof accepted === "string"
      ? accepted
      : accepted && typeof accepted === "object" && "address" in accepted && typeof accepted.address === "string"
        ? accepted.address
        : "";
    return address.toLowerCase() === recipient.toLowerCase();
  });
}

export async function sendTransactionalEmail(template: EmailTemplate, payload: EmailPayload, to: string, eventKey: string, transportFactory: TransactionalTransportFactory = createSmtpTransport) {
  const config = getSmtpConfiguration();
  const transporter = transportFactory(config);
  try {
    const message = buildTransactionalEmail(template, payload, config.from, to, stableEmailDedupeKey(eventKey));
    const result = await transporter.sendMail(message);
    if (!acceptedRecipientMatches(result, to)) {
      const error = new Error("SMTP provider did not accept the recipient.") as Error & { code: string };
      error.code = "MESSAGE_NOT_ACCEPTED";
      throw error;
    }
  } finally {
    transporter.close();
  }
}

export async function sendDiagnosticEmail(to: string, transportFactory: TransactionalTransportFactory = createSmtpTransport) {
  const config = getSmtpConfiguration();
  const transporter = transportFactory(config);
  try {
    const result = await transporter.sendMail({
      from: config.from,
      to,
      subject: "BAGATI email çatdırılma yoxlaması",
      text: "Bu, BAGATI SMTP çatdırılmasını yoxlamaq üçün bir dəfəlik sınaq məktubudur. Heç bir hesab yaradılmayıb və bu məktub təsdiq kodu deyil.",
      html: "<p>Bu, BAGATI SMTP çatdırılmasını yoxlamaq üçün bir dəfəlik sınaq məktubudur.</p><p>Heç bir hesab yaradılmayıb və bu məktub təsdiq kodu deyil.</p>",
    });
    if (!acceptedRecipientMatches(result, to)) {
      const error = new Error("SMTP provider did not accept the diagnostic recipient.") as Error & { code: string };
      error.code = "MESSAGE_NOT_ACCEPTED";
      throw error;
    }
  } finally {
    transporter.close();
  }
}

export async function verifySmtpConnection(
  transportFactory: SmtpCheckTransportFactory = config => createSmtpTransport(config, 15_000),
  timeoutMs = 15_000,
) {
  const transporter = transportFactory(getSmtpConfiguration());
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      transporter.verify(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(Object.assign(new Error("SMTP verification timed out."), { code: "ETIMEDOUT", command: "VERIFY" })), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    transporter.close();
  }
}
