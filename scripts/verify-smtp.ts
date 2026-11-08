import { loadEnvFile } from "node:process";
import { classifySmtpFailure, getSmtpConfiguration, safeSmtpErrorMetadata, SmtpConfigurationError, smtpTlsOptions, verifySmtpConnection } from "@/lib/email";

const categoryAdvice = {
  authentication: "Authentication failed. Check SMTP_USER and use the provider's SMTP/App Password; do not use the account's normal password.",
  tls: "TLS validation failed. Check Node's system-CA setting and the trusted certificate chain. Certificate validation remains enabled.",
  connection: "SMTP connection or DNS failed. Check outbound SMTP access and SMTP_HOST/SMTP_PORT.",
  timeout: "SMTP verification exceeded its 15-second deadline. Check network/TLS interception and SMTP server responsiveness.",
  sender_rejected: "The SMTP server rejected the sender. Check that SMTP_FROM is authorized for the authenticated SMTP_USER.",
  recipient_rejected: "The SMTP server rejected the recipient. Check the recipient address and provider sending policy.",
  provider_rejected: "The SMTP server rejected a command. Check the provider's SMTP policy and configuration.",
  unknown: "SMTP verification failed; sanitized metadata does not identify a narrower cause.",
} as const;

function forceExitOnVerificationTimeout(error: unknown) {
  const metadata = safeSmtpErrorMetadata(error);
  if (metadata.code === "ETIMEDOUT" && metadata.command === "VERIFY") {
    // Nodemailer's close event does not necessarily destroy an in-flight socket.
    // This one-shot diagnostic exits at its strict deadline instead of hanging.
    process.exit(1);
  }
}

async function main() {
  try {
    loadEnvFile(".env");
  } catch {
    console.error("SMTP verification unavailable: local .env could not be loaded.");
    process.exitCode = 1;
    return;
  }

  try {
    const config = getSmtpConfiguration();
    const tls = smtpTlsOptions(config.port);
    console.log("SMTP configuration:", {
      host: config.host,
      port: config.port,
      secure: tls.secure,
      requireTLS: tls.requireTLS ?? false,
      userPresent: Boolean(config.user.trim()),
      passwordPresent: Boolean(config.password),
      fromPresent: Boolean(config.from.trim()),
    });
  } catch (error) {
    if (error instanceof SmtpConfigurationError) {
      const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"] as const;
      const missing = required.filter(key => !process.env[key]?.trim());
      console.error(`SMTP verification not run: incomplete configuration (${missing.join(", ") || "SMTP_PORT must be 465 or 587"}).`);
    } else {
      console.error("SMTP verification could not read its configuration.");
    }
    process.exitCode = 1;
    return;
  }

  try {
    await verifySmtpConnection();
    console.log("SMTP connection verified. No message was sent; credentials were not displayed.");
  } catch (error) {
    const metadata = safeSmtpErrorMetadata(error);
    const category = classifySmtpFailure(metadata);
    console.error("SMTP connection verification failed.", { category, guidance: categoryAdvice[category], details: metadata });
    forceExitOnVerificationTimeout(error);
    process.exitCode = 1;
  }
}

void main();
