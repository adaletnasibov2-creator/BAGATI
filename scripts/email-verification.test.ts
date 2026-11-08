import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  buildVerificationEmail,
  classifySmtpFailure,
  getSmtpConfiguration,
  safeSmtpErrorMetadata,
  sendVerificationEmail,
  SmtpConfigurationError,
  smtpTlsOptions,
  verifySmtpConnection,
} from "../lib/email";
import {
  compareVerificationCode,
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_TTL_MS,
  emailCodeCanBeAttempted,
  emailVerificationRequired,
  emailResendCooldownSeconds,
  emailResendWindowExpired,
  generateVerificationCode,
  hashVerificationCode,
  mayUseVendorLogin,
} from "../lib/email-verification";

const priorEnv = { ...process.env };
after(() => {
  for (const key of ["SESSION_SECRET", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"]) {
    if (priorEnv[key] === undefined) delete process.env[key];
    else process.env[key] = priorEnv[key];
  }
});

describe("email verification security", () => {
  it("generates exactly six numeric digits, including possible leading zeroes", () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      assert.match(generateVerificationCode(), /^\d{6}$/);
    }
  });

  it("stores a keyed digest and compares codes without storing plaintext", () => {
    process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
    const code = "004281";
    const digest = hashVerificationCode(code);
    assert.notEqual(digest, code);
    assert.match(digest, /^[a-f0-9]{64}$/);
    assert.equal(compareVerificationCode(code, digest), true);
    assert.equal(compareVerificationCode("004282", digest), false);
  });

  it("expires codes after ten minutes and blocks attempts after the limit", () => {
    const now = new Date("2026-10-06T12:00:00.000Z");
    assert.equal(EMAIL_CODE_TTL_MS, 10 * 60 * 1000);
    assert.equal(emailCodeCanBeAttempted(new Date(now.getTime() + 1), 0, now), true);
    assert.equal(emailCodeCanBeAttempted(now, 0, now), false);
    assert.equal(emailCodeCanBeAttempted(new Date(now.getTime() + 1), EMAIL_CODE_MAX_ATTEMPTS, now), false);
  });

  it("enforces the resend cooldown and daily window", () => {
    const now = new Date("2026-10-06T12:00:00.000Z");
    assert.equal(emailResendCooldownSeconds(new Date(now.getTime() - 1_000), now), 59);
    assert.equal(emailResendCooldownSeconds(new Date(now.getTime() - 60_000), now), 0);
    assert.equal(emailResendWindowExpired(new Date(now.getTime() - 86_399_000), now), false);
    assert.equal(emailResendWindowExpired(new Date(now.getTime() - 86_400_000), now), true);
  });

  it("requires CUSTOMER and VENDOR verification but preserves ADMIN and verified logins", () => {
    const verifiedAt = new Date("2026-10-06T12:00:00.000Z");
    assert.equal(emailVerificationRequired("CUSTOMER", null), true);
    assert.equal(emailVerificationRequired("VENDOR", null), true);
    assert.equal(emailVerificationRequired("ADMIN", null), false);
    assert.equal(emailVerificationRequired("CUSTOMER", verifiedAt), false);
    assert.equal(emailVerificationRequired("VENDOR", verifiedAt), false);
  });

  it("keeps vendor login role validation server-side", () => {
    assert.equal(mayUseVendorLogin("VENDOR"), true);
    assert.equal(mayUseVendorLogin("CUSTOMER"), false);
    assert.equal(mayUseVendorLogin("ADMIN"), false);
  });
});

describe("verification email delivery configuration", () => {
  it("fails closed when SMTP credentials are missing", () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_FROM;
    assert.throws(() => getSmtpConfiguration(), SmtpConfigurationError);
  });

  it("builds an Azerbaijani email containing the code and expiry warning", () => {
    const email = buildVerificationEmail("BAGATI <shop@example.test>", "user@example.test", "004281");
    assert.equal(email.to, "user@example.test");
    assert.match(String(email.subject), /BAGATI/);
    assert.match(String(email.text), /004281/);
    assert.match(String(email.text), /10 dəqiqə/);
    assert.match(String(email.text), /heç kimlə paylaşmayın/);
    assert.throws(() => buildVerificationEmail("BAGATI", "user@example.test", "12345"));
  });

  it("passes the verification message to the email transport without requiring real credentials", async () => {
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "test-user";
    process.env.SMTP_PASSWORD = "test-token-only";
    process.env.SMTP_FROM = "BAGATI <no-reply@example.test>";
    const sent: Array<{ to?: unknown; text?: unknown }> = [];
    await sendVerificationEmail("user@example.test", "004281", () => ({
      sendMail: async (message) => { sent.push(message); return {} as never; },
    }));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "user@example.test");
    assert.match(String(sent[0].text ?? ""), /004281/);
  });

  it("uses Gmail-compatible TLS modes for ports 465 and 587", () => {
    assert.deepEqual(smtpTlsOptions(465), { secure: true });
    assert.deepEqual(smtpTlsOptions(587), { secure: false, requireTLS: true });
  });

  it("verifies the configured SMTP transport and closes it without sending mail", async () => {
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "test-user";
    process.env.SMTP_PASSWORD = "test-token-only";
    process.env.SMTP_FROM = "BAGATI <no-reply@example.test>";
    let verified = false;
    let closed = false;
    await verifySmtpConnection(() => ({
      verify: async () => { verified = true; return true as const; },
      close: () => { closed = true; },
    }));
    assert.equal(verified, true);
    assert.equal(closed, true);
  });

  it("times out a stalled SMTP verification and closes the transport", async () => {
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "test-user";
    process.env.SMTP_PASSWORD = "test-token-only";
    process.env.SMTP_FROM = "BAGATI <no-reply@example.test>";
    let closed = false;
    await assert.rejects(
      verifySmtpConnection(() => ({ verify: () => new Promise<true>(() => undefined), close: () => { closed = true; } }), 5),
      (error: unknown) => {
        const metadata = safeSmtpErrorMetadata(error);
        assert.deepEqual(metadata, { code: "ETIMEDOUT", command: "VERIFY" });
        assert.equal(JSON.stringify(metadata).includes("test-token-only"), false);
        return true;
      },
    );
    assert.equal(closed, true);
  });

  it("classifies sanitized SMTP failure metadata", () => {
    assert.equal(classifySmtpFailure({ code: "EAUTH", command: "AUTH" }), "authentication");
    assert.equal(classifySmtpFailure({ code: "ETLS", command: "STARTTLS" }), "tls");
    assert.equal(classifySmtpFailure({ code: "ECONNREFUSED", command: "CONN" }), "connection");
    assert.equal(classifySmtpFailure({ code: "ETIMEDOUT", command: "VERIFY" }), "timeout");
    assert.equal(classifySmtpFailure({ command: "MAIL FROM", responseCode: 550 }), "sender_rejected");
    assert.equal(classifySmtpFailure({ command: "RCPT TO", responseCode: 550 }), "recipient_rejected");
  });

  it("logs SMTP failure metadata without exposing error messages or credentials", () => {
    const error = Object.assign(new Error("AUTH failed for secret-password"), { code: "EAUTH", responseCode: 535 });
    const metadata = safeSmtpErrorMetadata(error);
    assert.deepEqual(metadata, { code: "EAUTH", responseCode: 535 });
    assert.equal(JSON.stringify(metadata).includes("secret-password"), false);
  });
});
