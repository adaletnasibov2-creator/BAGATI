import { loadEnvFile } from "node:process";
import { z } from "zod";
import { sendDiagnosticEmail, safeSmtpErrorMetadata, classifySmtpFailure, SmtpConfigurationError } from "@/lib/email";

try { loadEnvFile(".env"); } catch { /* Production environments provide variables directly. */ }

async function main() {
  const [recipient, ...extra] = process.argv.slice(2);
  const parsed = z.string().trim().email().max(254).safeParse(recipient);
  if (extra.length || !parsed.success) {
    throw Object.assign(new Error("Usage: npm.cmd run email:test-send -- <address-you-control>"), { code: "INVALID_RECIPIENT" });
  }
  await sendDiagnosticEmail(parsed.data);
  console.log("Diagnostic email accepted by the SMTP provider. Check the specified inbox and spam folder; this command does not verify inbox delivery.");
}

main().catch((error: unknown) => {
  const failure = error instanceof SmtpConfigurationError ? "SMTP_CONFIGURATION_INVALID"
    : error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code
      : "EMAIL_DIAGNOSTIC_FAILED";
  console.error(`Diagnostic email was not confirmed (${failure}).`, {
    category: classifySmtpFailure(safeSmtpErrorMetadata(error)),
    smtp: safeSmtpErrorMetadata(error),
  });
  process.exitCode = 1;
});
