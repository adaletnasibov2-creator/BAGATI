import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptEmailSecret, encryptEmailSecret } from "@/lib/email-outbox";
import { diagnoseEmailDeliveryFailure, emailRetryDelayMs, isSafeEmailRetry, safeEmailFailureCode, safeEmailFailureType, safeWorkerFailureCode, stableEmailDedupeKey } from "@/lib/email-outbox-core";
import { buildTransactionalEmail, type EmailPayload } from "@/lib/email-templates";
import { safeSmtpErrorMetadata, sendDiagnosticEmail, sendTransactionalEmail } from "@/lib/email";
import { enqueueEmail } from "@/lib/email-outbox";
import { isMissingDiagnosticColumn, processEmailOutboxBatch, requeueRetrySafeOutbox } from "@/lib/email-outbox-worker";
import { compareVerificationCode, hashVerificationCode } from "@/lib/email-verification";
import { evaluateEmailWorkerMonitoring, parseEmailWorkerHeartbeat, EMAIL_OUTBOX_AGE_WARNING_MS, EMAIL_WORKER_STALE_AFTER_MS, EMAIL_WORKER_SUCCESS_STALE_AFTER_MS, type EmailWorkerHeartbeat } from "@/lib/email-worker-monitoring";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("event keys are stable, distinct, and safe for SMTP message identifiers", () => {
  const first = stableEmailDedupeKey("order-confirmed:order-1:customer@example.test");
  assert.equal(first, stableEmailDedupeKey("order-confirmed:order-1:customer@example.test"));
  assert.notEqual(first, stableEmailDedupeKey("order-confirmed:order-2:customer@example.test"));
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("duplicate event enqueues use the same unique database key and encrypt payloads", async () => {
  const creates: Array<Record<string, unknown>> = [];
  const fake = { emailOutbox: { upsert: async (input: { where: { dedupeKey: string }; create: Record<string, unknown> }) => { creates.push(input.create); return { id: "mock" }; } } };
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-chars";
  try {
    const event = { eventKey: "welcome:user-1", recipient: "test@example.test", template: "WELCOME_CUSTOMER", payload: { name: "Test" } };
    await enqueueEmail(fake as never, event);
    await enqueueEmail(fake as never, event);
    assert.equal(creates.length, 2);
    assert.equal(creates[0].dedupeKey, creates[1].dedupeKey);
    assert.equal(JSON.stringify(creates[0].payload).includes("Test"), false);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test("outbox payload encryption round-trips and does not store plaintext", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-chars";
  try {
    const secret = "123456";
    const encrypted = encryptEmailSecret(JSON.stringify({ code: secret, name: "Aysel" }));
    assert.equal(encrypted.includes(secret), false);
    assert.deepEqual(JSON.parse(decryptEmailSecret(encrypted)), { code: secret, name: "Aysel" });
    assert.throws(() => decryptEmailSecret(`${encrypted.slice(0, -2)}xx`));
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test("Azerbaijani templates escape user text and reject non-HTTPS tracking links", () => {
  const message = buildTransactionalEmail("WELCOME_CUSTOMER", { name: `<img src=x onerror="alert(1)">` }, "from@example.test", "to@example.test", "id");
  assert.match(String(message.html), /&lt;img/);
  assert.doesNotMatch(String(message.html), /<img/);
  assert.equal(message.messageId, "<id@example.test>");
  assert.equal(
    buildTransactionalEmail("WELCOME_CUSTOMER", {}, "BAGATI <sender@shop.example>", "to@example.test", "stable-id").messageId,
    "<stable-id@shop.example>",
  );
  assert.throws(() => buildTransactionalEmail("WELCOME_CUSTOMER", {}, "invalid-sender", "to@example.test", "id"), /fully qualified domain/);
  assert.match(String(message.subject), /xoş gəlmisiniz/i);
  const shipment = buildTransactionalEmail("SHIPMENT_UPDATE", { trackingUrl: "javascript:alert(1)", statusLabel: "Çatdırılır" }, "from@example.test", "to@example.test", "id");
  assert.doesNotMatch(String(shipment.html), /javascript:/i);
});

test("delivery requires provider acceptance and closes the mock transport", async () => {
  const prior = { host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, user: process.env.SMTP_USER, password: process.env.SMTP_PASSWORD, from: process.env.SMTP_FROM };
  Object.assign(process.env, { SMTP_HOST: "smtp.example.test", SMTP_PORT: "465", SMTP_USER: "mock", SMTP_PASSWORD: "mock-secret", SMTP_FROM: "from@example.test" });
  let closed = false;
  try {
    await sendTransactionalEmail("WELCOME_CUSTOMER", {}, "to@example.test", "event-1", () => ({
      sendMail: async () => ({ accepted: ["to@example.test"], rejected: [], response: "250 accepted", messageId: "mock" }),
      close: () => { closed = true; },
    }));
    assert.equal(closed, true);
    await assert.rejects(() => sendTransactionalEmail("WELCOME_CUSTOMER", {}, "to@example.test", "event-2", () => ({
      sendMail: async () => ({ accepted: [], rejected: ["to@example.test"], response: "550 rejected", messageId: "mock" }),
      close: () => undefined,
    })), /did not accept/);
  } finally {
    for (const [key, value] of Object.entries({ SMTP_HOST: prior.host, SMTP_PORT: prior.port, SMTP_USER: prior.user, SMTP_PASSWORD: prior.password, SMTP_FROM: prior.from })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("transactional delivery recognizes Nodemailer accepted recipient address objects", async () => {
  const prior = { host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, user: process.env.SMTP_USER, password: process.env.SMTP_PASSWORD, from: process.env.SMTP_FROM };
  Object.assign(process.env, { SMTP_HOST: "smtp.example.test", SMTP_PORT: "465", SMTP_USER: "mock", SMTP_PASSWORD: "mock-secret", SMTP_FROM: "from@example.test" });
  let closed = false;
  try {
    await sendTransactionalEmail("EMAIL_VERIFICATION", { code: "004281" }, "to@example.test", "event-address-object", () => ({
      sendMail: async () => ({
        accepted: [{ name: "", address: "TO@example.test" }],
        rejected: [],
        response: "250 accepted",
        messageId: "mock",
      }),
      close: () => { closed = true; },
    }));
    assert.equal(closed, true);
  } finally {
    for (const [key, value] of Object.entries({ SMTP_HOST: prior.host, SMTP_PORT: prior.port, SMTP_USER: prior.user, SMTP_PASSWORD: prior.password, SMTP_FROM: prior.from })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("diagnostic delivery targets only the requested address and closes the transport", async () => {
  const prior = { host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, user: process.env.SMTP_USER, password: process.env.SMTP_PASSWORD, from: process.env.SMTP_FROM };
  Object.assign(process.env, { SMTP_HOST: "smtp.example.test", SMTP_PORT: "465", SMTP_USER: "mock", SMTP_PASSWORD: "mock-secret", SMTP_FROM: "from@example.test" });
  let message: { to?: unknown; subject?: unknown; text?: unknown } | undefined;
  let closed = false;
  try {
    await sendDiagnosticEmail("controlled@example.test", () => ({
      sendMail: async input => { message = { to: input.to, subject: input.subject, text: input.text }; return { accepted: ["controlled@example.test"], rejected: [], response: "250 accepted", messageId: "mock" }; },
      close: () => { closed = true; },
    }));
    assert.equal(message?.to, "controlled@example.test");
    assert.match(String(message?.subject), /çatdırılma yoxlaması/i);
    assert.match(String(message?.text), /təsdiq kodu deyil/i);
    assert.equal(closed, true);
    await assert.rejects(() => sendDiagnosticEmail("controlled@example.test", () => ({
      sendMail: async () => ({ accepted: [], rejected: ["controlled@example.test"], response: "550 rejected", messageId: "mock" }),
      close: () => undefined,
    })), /did not accept/);
  } finally {
    for (const [key, value] of Object.entries({ SMTP_HOST: prior.host, SMTP_PORT: prior.port, SMTP_USER: prior.user, SMTP_PASSWORD: prior.password, SMTP_FROM: prior.from })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("retry policy retries known transient pre-acceptance failures only", () => {
  assert.equal(isSafeEmailRetry({ code: "ECONNECTION", command: "CONN" }), false);
  assert.equal(isSafeEmailRetry({ code: "ETIMEDOUT", command: "CONN" }), false);
  assert.equal(isSafeEmailRetry({ code: "ESOCKET", command: "CONN" }), false);
  assert.equal(isSafeEmailRetry({ code: "EAUTH", command: "AUTH" }), false);
  assert.equal(isSafeEmailRetry({ code: "ESOCKET", command: "DATA" }), false);
  assert.equal(isSafeEmailRetry({ responseCode: 550, command: "RCPT TO" }), false);
  assert.equal(emailRetryDelayMs(2), 30_000);
});

test("worker retains a temporary connection failure for safe retry and marks it sent after acceptance", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-chars";
  const encryptedPayload = encryptEmailSecret(JSON.stringify({ name: "Test" }));
  const state = { status: "PENDING", attempts: 0, availableAt: new Date(Date.now() - 1_000), lastErrorCode: null as string | null, retrySafe: false };
  let sends = 0;
  const database = {
    emailOutbox: {
      updateMany: async ({ where, data }: { where: { status: string }; data?: Record<string, unknown> }) => {
        if (where.status === "PROCESSING") return { count: 0 };
        if (state.status !== "PENDING") return { count: 0 };
        state.status = "PROCESSING";
        state.attempts += 1;
        return { count: 1 };
      },
      findMany: async () => state.status === "PENDING" && state.availableAt <= new Date() ? [{
        id: "retry-fixture",
        template: "WELCOME_CUSTOMER",
        recipient: "customer@example.test",
        payload: { encrypted: encryptedPayload },
        dedupeKey: "retry-event",
        attempts: state.attempts,
        availableAt: state.availableAt,
        createdAt: new Date(),
      }] : [],
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.status = String(data.status);
        state.availableAt = data.availableAt instanceof Date ? data.availableAt : state.availableAt;
        state.lastErrorCode = typeof data.lastErrorCode === "string" ? data.lastErrorCode : null;
        state.retrySafe = data.retrySafe === true;
        return {};
      },
    },
    emailVerification: { findUnique: async () => null },
    user: { findFirst: async () => null },
  };
  const previousError = console.error;
  console.error = () => undefined;
  try {
    const dependencies = {
      prisma: database as never,
      assertSmtpConfigured: () => undefined,
      sendTransactionalEmail: async () => {
        sends += 1;
        if (sends === 1) throw Object.assign(new Error("private transport message"), { code: "ECONNECTION", command: "EHLO", responseCode: 421 });
      },
    };
    const first = await processEmailOutboxBatch(1, dependencies);
    assert.deepEqual(first, { processed: 1, sent: 0, failed: 1 });
    assert.equal(state.status, "PENDING");
    assert.equal(state.retrySafe, true);
    assert.equal(state.lastErrorCode, "ECONNECTION");
    assert.ok(state.availableAt.getTime() >= Date.now() + 14_000);
    state.availableAt = new Date(Date.now() - 1_000);
    const second = await processEmailOutboxBatch(1, dependencies);
    assert.deepEqual(second, { processed: 1, sent: 1, failed: 0 });
    assert.equal(state.status, "SENT");
    assert.equal(state.retrySafe, false);
    assert.equal(state.lastErrorCode, null);
    assert.equal(sends, 2);
  } finally {
    console.error = previousError;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("targeted worker delivery and stale-lock recovery are restricted to the selected outbox row", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-chars";
  const encryptedPayload = encryptEmailSecret(JSON.stringify({ name: "Test" }));
  const selectedId = "selected-outbox-row";
  const unrelatedId = "unrelated-outbox-row";
  const queryFilters: Array<Record<string, unknown>> = [];
  const candidates = [selectedId, unrelatedId].map(id => ({
    id,
    template: "WELCOME_CUSTOMER",
    recipient: `${id}@example.test`,
    payload: { encrypted: encryptedPayload },
    dedupeKey: `dedupe-${id}`,
    attempts: 0,
    availableAt: new Date(Date.now() - 1_000),
    createdAt: new Date(),
  }));
  const database = {
    emailOutbox: {
      updateMany: async ({ where }: { where: Record<string, unknown> }) => {
        queryFilters.push(where);
        return { count: 1 };
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        queryFilters.push(where);
        return candidates.filter(candidate => candidate.id === where.id);
      },
      update: async () => ({}),
    },
    emailVerification: { findUnique: async () => null },
    user: { findFirst: async () => null },
  };
  const sent: string[] = [];
  try {
    const result = await processEmailOutboxBatch(1, {
      prisma: database as never,
      assertSmtpConfigured: () => undefined,
      sendTransactionalEmail: async (_template, _payload, recipient) => { sent.push(recipient); },
    }, selectedId);
    assert.deepEqual(result, { processed: 1, sent: 1, failed: 0 });
    assert.equal(queryFilters.length, 3);
    assert.ok(queryFilters.every(filter => filter.id === selectedId));
    assert.deepEqual(sent, [`${selectedId}@example.test`]);
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("worker does not send an expired verification code and records an actionable failure", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-chars";
  const expiredAt = new Date(Date.now() - 1_000);
  const code = "004281";
  const codeHash = hashVerificationCode(code);
  const encryptedCode = encryptEmailSecret(code);
  const encryptedPayload = encryptEmailSecret(JSON.stringify({
    userId: "expired-user",
    codeHash,
    encryptedCode,
    expiresAt: expiredAt.toISOString(),
  }));
  let delivered = 0;
  let finalUpdate: Record<string, unknown> | undefined;
  const database = {
    emailOutbox: {
      updateMany: async () => ({ count: 1 }),
      findMany: async () => [{
        id: "expired-fixture",
        template: "EMAIL_VERIFICATION",
        recipient: "expired@example.test",
        payload: { encrypted: encryptedPayload },
        dedupeKey: "expired-event",
        attempts: 0,
        availableAt: new Date(Date.now() - 1_000),
        createdAt: new Date(),
      }],
      update: async ({ data }: { data: Record<string, unknown> }) => { finalUpdate = data; return {}; },
    },
    emailVerification: { findUnique: async () => ({ codeHash, expiresAt: expiredAt, attempts: 0 }) },
    user: { findFirst: async () => ({ id: "expired-user" }) },
  };
  const previousError = console.error;
  console.error = () => undefined;
  try {
    const result = await processEmailOutboxBatch(1, {
      prisma: database as never,
      assertSmtpConfigured: () => undefined,
      sendTransactionalEmail: async () => { delivered += 1; },
    });

    assert.deepEqual(result, { processed: 1, sent: 0, failed: 1 });
    assert.equal(delivered, 0);
    assert.equal(finalUpdate?.status, "FAILED");
    assert.equal(finalUpdate?.retrySafe, false);
    assert.equal(finalUpdate?.lastErrorCode, "VERIFICATION_STALE");
  } finally {
    console.error = previousError;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("verification delivery failures log safe diagnostics and retry only temporary SMTP rejection", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-chars";
  const code = "004281";
  const expiresAt = new Date(Date.now() + 60_000);
  const codeHash = hashVerificationCode(code);
  const encryptedPayload = encryptEmailSecret(JSON.stringify({
    userId: "verification-user",
    codeHash,
    encryptedCode: encryptEmailSecret(code),
    expiresAt: expiresAt.toISOString(),
  }));
  const logs: unknown[][] = [];
  let finalUpdate: Record<string, unknown> | undefined;
  const database = {
    emailOutbox: {
      updateMany: async () => ({ count: 1 }),
      findMany: async () => [{
        id: "verification-outbox-123",
        template: "EMAIL_VERIFICATION",
        recipient: "private-recipient@example.test",
        payload: { encrypted: encryptedPayload },
        dedupeKey: "verification-event",
        attempts: 0,
        availableAt: new Date(Date.now() - 1_000),
        createdAt: new Date(),
      }],
      update: async ({ data }: { data: Record<string, unknown> }) => { finalUpdate = data; return {}; },
    },
    emailVerification: { findUnique: async () => ({ codeHash, expiresAt, attempts: 0 }) },
    user: { findFirst: async () => ({ id: "verification-user" }) },
  };
  const previousError = console.error;
  console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    const result = await processEmailOutboxBatch(1, {
      prisma: database as never,
      assertSmtpConfigured: () => undefined,
      sendTransactionalEmail: async () => {
        throw Object.assign(new Error("private provider response and recipient"), {
          command: "RCPT TO",
          responseCode: 450,
        });
      },
    });

    assert.deepEqual(result, { processed: 1, sent: 0, failed: 1 });
    assert.equal(logs.length, 1);
    const log = JSON.stringify(logs[0]);
    assert.match(log, /"outboxId":"verification-outbox-123"/);
    assert.match(log, /"template":"EMAIL_VERIFICATION"/);
    assert.match(log, /"stage":"smtp_send"/);
    assert.match(log, /"failureCode":"SMTP_450"/);
    assert.match(log, /"failureType":"Error"/);
    assert.match(log, /"failureCategory":"recipient_rejected"/);
    assert.match(log, /"retryDecision":"retry"/);
    assert.match(log, /"retryDelayMs":15000/);
    assert.doesNotMatch(log, /004281|private-recipient@example\.test|private provider response/);
    assert.equal(finalUpdate?.status, "PENDING");
    assert.equal(finalUpdate?.retrySafe, true);
    assert.equal(finalUpdate?.lastErrorCode, "SMTP_450");
  } finally {
    console.error = previousError;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("worker sends only a current, unused password-reset link", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-chars";
  const expiresAt = new Date(Date.now() + 60_000);
  const payload = {
    tokenHash: "hashed-reset-token",
    expiresAt: expiresAt.toISOString(),
    resetUrl: "https://bagati.example/reset-password?token=opaque-test-token",
  };
  const encryptedPayload = encryptEmailSecret(JSON.stringify(payload));
  const records = [
    { id: "current-reset", usedAt: null },
    { id: "used-reset", usedAt: new Date() },
  ];
  let resetQuery = 0;
  const states = new Map(records.map(({ id }) => [id, { status: "PENDING", attempts: 0 }]));
  const database = {
    emailOutbox: {
      updateMany: async ({ where }: { where: { id?: string; status?: string } }) => {
        if (where.status === "PROCESSING") return { count: 0 };
        const row = states.get(where.id!);
        if (!row || row.status !== "PENDING") return { count: 0 };
        row.status = "PROCESSING";
        row.attempts += 1;
        return { count: 1 };
      },
      findMany: async () => records.map(({ id }) => ({
        id,
        template: "PASSWORD_RESET",
        recipient: "customer@example.test",
        payload: { encrypted: encryptedPayload },
        dedupeKey: `dedupe-${id}`,
        attempts: 0,
        availableAt: new Date(Date.now() - 1_000),
        createdAt: new Date(),
      })),
      update: async ({ where, data }: { where: { id: string }; data: { status: string } }) => {
        states.get(where.id)!.status = data.status;
        return {};
      },
    },
    emailVerification: { findUnique: async () => null },
    user: { findFirst: async () => ({ id: "reset-user" }) },
    $queryRaw: async () => [{ userId: "reset-user", expiresAt, usedAt: records[resetQuery++]?.usedAt ?? null }],
  };
  const previousError = console.error;
  console.error = () => undefined;
  try {
    const sent: Array<{ template: string; payload: EmailPayload }> = [];
    const result = await processEmailOutboxBatch(2, {
      prisma: database as never,
      assertSmtpConfigured: () => undefined,
      sendTransactionalEmail: async (template, sentPayload) => { sent.push({ template, payload: sentPayload }); },
    });
    assert.deepEqual(result, { processed: 2, sent: 1, failed: 1 });
    assert.equal(states.get("current-reset")?.status, "SENT");
    assert.equal(states.get("used-reset")?.status, "FAILED");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].template, "PASSWORD_RESET");
    assert.equal(sent[0].payload.resetUrl, payload.resetUrl);
  } finally {
    console.error = previousError;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("verification messages that expire before delivery retain a safe actionable failure code", () => {
  assert.equal(safeEmailFailureCode(Object.assign(new Error("private details"), { code: "VERIFICATION_STALE" })), "VERIFICATION_STALE");
});

test("failure diagnostics retain allowlisted error type and Prisma code without exposing messages", () => {
  const error = Object.assign(new Error("private database host and credentials"), { code: "P2002" });
  assert.equal(safeEmailFailureCode(error), "PRISMA_P2002");
  assert.equal(safeEmailFailureType(error), "Error");
  const prismaError = Object.assign(new Error("private database host and credentials"), { name: "PrismaClientKnownRequestError", code: "P2002" });
  assert.equal(safeEmailFailureType(prismaError), "PrismaClientKnownRequestError");
  const untrustedName = Object.assign(new Error("private"), { name: "token-secret@example.test" });
  assert.equal(safeEmailFailureType(untrustedName), "Error");
  assert.equal(JSON.stringify({ code: safeEmailFailureCode(error), type: safeEmailFailureType(error) }).includes("private"), false);
});

test("worker logs failure stage and safe diagnostics, not the thrown error or recipient", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-chars";
  const encryptedPayload = encryptEmailSecret(JSON.stringify({ name: "Test" }));
  const logs: unknown[][] = [];
  const updates: Record<string, unknown>[] = [];
  const database = {
    emailOutbox: {
      updateMany: async ({ where }: { where: { status: string } }) => ({ count: where.status === "PENDING" ? 1 : 0 }),
      findMany: async () => [{
        id: "diagnostic-fixture",
        template: "WELCOME_CUSTOMER",
        recipient: "private-recipient@example.test",
        payload: { encrypted: encryptedPayload },
        dedupeKey: "diagnostic-event",
        attempts: 0,
        availableAt: new Date(Date.now() - 1_000),
        createdAt: new Date(),
      }],
      update: async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return {}; },
    },
    emailVerification: { findUnique: async () => null },
    user: { findFirst: async () => null },
  };
  const previousError = console.error;
  console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    const result = await processEmailOutboxBatch(1, {
      prisma: database as never,
      assertSmtpConfigured: () => undefined,
      sendTransactionalEmail: async () => {
        throw Object.assign(new Error("private SMTP response and credential"), { code: "EAUTH" });
      },
    });
    assert.deepEqual(result, { processed: 1, sent: 0, failed: 1 });
    assert.equal(updates.at(-1)?.lastErrorCode, "EAUTH");
    assert.equal(logs.length, 1);
    const log = JSON.stringify(logs[0]);
    assert.match(log, /"stage":"smtp_send"/);
    assert.match(log, /"failureCode":"EAUTH"/);
    assert.match(log, /"failureType":"Error"/);
    assert.match(log, /"failureCategory":"authentication"/);
    assert.match(log, /"retryDecision":"terminal"/);
    assert.match(log, /"retryDelayMs":0/);
    assert.doesNotMatch(log, /private SMTP response|credential|private-recipient@example\.test/);
  } finally {
    console.error = previousError;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("worker replaces an unexpected template with a fixed log value", async () => {
  const logs: unknown[][] = [];
  let delivered = false;
  const database = {
    emailOutbox: {
      updateMany: async ({ where }: { where: { status: string } }) => ({ count: where.status === "PENDING" ? 1 : 0 }),
      findMany: async () => [{
        id: "unsafe-template-fixture",
        template: "private-recipient@example.test",
        recipient: "customer@example.test",
        payload: {},
        dedupeKey: "unsafe-template-event",
        attempts: 0,
        availableAt: new Date(Date.now() - 1_000),
        createdAt: new Date(),
      }],
      update: async () => ({}),
    },
    emailVerification: { findUnique: async () => null },
    user: { findFirst: async () => null },
  };
  const previousError = console.error;
  console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    const result = await processEmailOutboxBatch(1, {
      prisma: database as never,
      assertSmtpConfigured: () => undefined,
      sendTransactionalEmail: async () => { delivered = true; },
    });
    assert.deepEqual(result, { processed: 1, sent: 0, failed: 1 });
    assert.equal(delivered, false);
    assert.equal(logs.length, 1);
    assert.match(JSON.stringify(logs[0]), /"template":"UNKNOWN_TEMPLATE"/);
    assert.doesNotMatch(JSON.stringify(logs[0]), /private-recipient@example\.test/);
  } finally {
    console.error = previousError;
  }
});

test("worker-level error codes use a fixed allowlist and hide untrusted text", () => {
  assert.equal(safeWorkerFailureCode({ code: "EAUTH" }), "EAUTH");
  assert.equal(safeWorkerFailureCode({ code: "P1001" }), "P1001");
  assert.equal(safeWorkerFailureCode({ code: "private@example.test" }), "UNKNOWN_ERROR_CODE");
  assert.equal(safeWorkerFailureCode({ code: "TOKEN_SECRET_123" }), "UNKNOWN_ERROR_CODE");
  assert.equal(safeWorkerFailureCode(new Error("private raw error")), "UNKNOWN_ERROR_CODE");
});

test("SMTP diagnostics expose allowlisted transport metadata only", () => {
  const metadata = safeSmtpErrorMetadata(Object.assign(new Error("private message"), {
    code: "ESOCKET",
    command: "CONN",
    syscall: "connect",
    address: "142.0.0.1",
    port: 465,
    password: "must-not-appear",
    response: "must-not-appear",
  }));
  assert.deepEqual(metadata, { code: "ESOCKET", command: "CONN", syscall: "connect", address: "142.0.0.1", port: 465 });
  assert.equal(JSON.stringify(metadata).includes("must-not-appear"), false);
  assert.equal(JSON.stringify(metadata).includes("private message"), false);
});

test("SMTP metadata drops untrusted command and syscall strings", () => {
  const metadata = safeSmtpErrorMetadata(Object.assign(new Error("private message"), {
    command: "RCPT TO private@example.test",
    syscall: "connect-with-secret",
  }));
  assert.deepEqual(metadata, {});
  assert.doesNotMatch(JSON.stringify(metadata), /private|secret|example\.test/);
});

test("worker monitoring marks a recent watch heartbeat healthy", () => {
  const now = new Date("2026-10-15T20:00:00.000Z");
  const heartbeat: EmailWorkerHeartbeat = {
    version: 1,
    startedAt: "2026-10-15T19:59:00.000Z",
    heartbeatAt: "2026-10-15T19:59:50.000Z",
    lastPollStartedAt: "2026-10-15T19:59:30.000Z",
    lastPollCompletedAt: "2026-10-15T19:59:31.000Z",
    lastSuccessfulPollAt: "2026-10-15T19:59:31.000Z",
    lastPollErrorCode: null,
    lastPollErrorType: null,
    lastPollProcessed: 0,
    lastPollSent: 0,
    lastPollFailed: 0,
    stoppedAt: null,
  };
  assert.deepEqual(evaluateEmailWorkerMonitoring({
    heartbeat,
    pendingCount: 0,
    readyPendingCount: 0,
    oldestReadyPendingAgeMs: null,
    failedCount: 0,
    smtpConfigured: true,
    encryptionConfigured: true,
  }, now), { status: "healthy", workerState: "alive", warnings: [] });
});

test("worker monitoring warns for a stopped or stale worker and an overdue successful poll", () => {
  const now = new Date("2026-10-15T20:00:00.000Z");
  const heartbeat: EmailWorkerHeartbeat = {
    version: 1,
    startedAt: "2026-10-15T19:55:00.000Z",
    heartbeatAt: new Date(now.getTime() - EMAIL_WORKER_STALE_AFTER_MS - 1).toISOString(),
    lastPollStartedAt: null,
    lastPollCompletedAt: null,
    lastSuccessfulPollAt: new Date(now.getTime() - EMAIL_WORKER_SUCCESS_STALE_AFTER_MS - 1).toISOString(),
    lastPollErrorCode: null,
    lastPollErrorType: null,
    lastPollProcessed: null,
    lastPollSent: null,
    lastPollFailed: null,
    stoppedAt: null,
  };
  const stale = evaluateEmailWorkerMonitoring({
    heartbeat, pendingCount: 0, readyPendingCount: 0, oldestReadyPendingAgeMs: null,
    failedCount: 0, smtpConfigured: true, encryptionConfigured: true,
  }, now);
  assert.equal(stale.workerState, "stale");
  assert.deepEqual(stale.warnings, ["worker_heartbeat_stale", "worker_poll_not_recently_successful"]);

  const stopped = evaluateEmailWorkerMonitoring({
    heartbeat: { ...heartbeat, stoppedAt: now.toISOString() },
    pendingCount: 0, readyPendingCount: 0, oldestReadyPendingAgeMs: null,
    failedCount: 0, smtpConfigured: true, encryptionConfigured: true,
  }, now);
  assert.equal(stopped.workerState, "stopped");
  assert.ok(stopped.warnings.includes("worker_stopped"));
});

test("worker monitoring warns on a failed poll, queue age, failed messages and missing configuration", () => {
  const now = new Date("2026-10-15T20:00:00.000Z");
  const heartbeat: EmailWorkerHeartbeat = {
    version: 1,
    startedAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
    lastPollStartedAt: now.toISOString(),
    lastPollCompletedAt: now.toISOString(),
    lastSuccessfulPollAt: now.toISOString(),
    lastPollErrorCode: "P1001",
    lastPollErrorType: "PrismaClientInitializationError",
    lastPollProcessed: null,
    lastPollSent: null,
    lastPollFailed: null,
    stoppedAt: null,
  };
  const result = evaluateEmailWorkerMonitoring({
    heartbeat,
    pendingCount: 3,
    readyPendingCount: 2,
    oldestReadyPendingAgeMs: EMAIL_OUTBOX_AGE_WARNING_MS + 1,
    failedCount: 1,
    smtpConfigured: false,
    encryptionConfigured: false,
  }, now);
  assert.deepEqual(result.warnings, [
    "worker_last_poll_failed",
    "worker_database_connection_failed",
    "pending_queue_age_exceeded",
    "failed_messages_present",
    "smtp_not_configured",
    "payload_encryption_not_configured",
  ]);
});

test("worker heartbeat parser rejects unsafe diagnostics and drops unrecognized fields", () => {
  const heartbeat = {
    version: 1,
    startedAt: "2026-10-15T19:59:00.000Z",
    heartbeatAt: "2026-10-15T19:59:50.000Z",
    lastPollStartedAt: null,
    lastPollCompletedAt: null,
    lastSuccessfulPollAt: null,
    lastPollErrorCode: null,
    lastPollErrorType: null,
    lastPollProcessed: null,
    lastPollSent: null,
    lastPollFailed: null,
    stoppedAt: null,
    recipient: "private@example.test",
  };
  const parsed = parseEmailWorkerHeartbeat(heartbeat);
  assert.ok(parsed);
  assert.equal("recipient" in parsed, false);
  assert.equal(parseEmailWorkerHeartbeat({ ...heartbeat, lastPollErrorCode: "token-secret" }), null);
  assert.equal(parseEmailWorkerHeartbeat({ ...heartbeat, lastPollErrorType: "private@example.test" }), null);
});

test("worker delivers the verification code accepted by the verification logic", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-chars";
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  const code = "004281";
  const codeHash = hashVerificationCode(code);
  const encryptedCode = encryptEmailSecret(code);
  const encryptedPayload = encryptEmailSecret(JSON.stringify({
    userId: "test-user",
    codeHash,
    encryptedCode,
    expiresAt: expiresAt.toISOString(),
  }));
  let delivered = 0;
  let deliveredPayload: EmailPayload | undefined;
  let finalUpdate: Record<string, unknown> | undefined;
  const database = {
    emailOutbox: {
      updateMany: async ({ where }: { where: { status: string } }) => ({ count: where.status === "PENDING" ? 1 : 0 }),
      findMany: async () => [{
        id: "outbox-fixture",
        template: "EMAIL_VERIFICATION",
        recipient: "customer@example.test",
        payload: { encrypted: encryptedPayload },
        dedupeKey: "fixture-event",
        attempts: 0,
        availableAt: new Date(Date.now() - 1_000),
        createdAt: new Date(),
      }],
      update: async ({ data }: { data: Record<string, unknown> }) => { finalUpdate = data; return {}; },
    },
    emailVerification: { findUnique: async () => ({ codeHash, expiresAt, attempts: 0 }) },
    user: { findFirst: async () => ({ id: "test-user" }) },
  };

  try {
    const result = await processEmailOutboxBatch(1, {
      prisma: database as never,
      assertSmtpConfigured: () => undefined,
      sendTransactionalEmail: async (_template, payload) => { delivered += 1; deliveredPayload = payload; },
    });
    assert.deepEqual(result, { processed: 1, sent: 1, failed: 0 });
    assert.equal(delivered, 1);
    assert.equal(deliveredPayload?.code, code);
    assert.equal(compareVerificationCode(String(deliveredPayload?.code), codeHash), true);
    assert.equal(finalUpdate?.status, "SENT");
    assert.equal(finalUpdate?.lastErrorCode, null);
    assert.equal(JSON.stringify({ encryptedPayload }).includes(decryptEmailSecret(encryptedCode)), false);
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("event routes enqueue within committed flows and admin email operations require ADMIN", () => {
  const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
  for (const route of ["app/api/auth/register/route.ts", "app/api/orders/route.ts", "app/api/vendor/apply/route.ts", "app/api/admin/stores/[storeId]/review/route.ts"]) {
    assert.match(source(route), /enqueue(?:Verification)?Email\(/, `${route} should enqueue its actual event`);
  }
  const adminEmail = source("app/api/admin/email/route.ts");
  assert.equal((adminEmail.match(/requireRole\("ADMIN"\)/g) ?? []).length, 2);
  assert.match(adminEmail, /retrySafe: true/);
  assert.doesNotMatch(adminEmail, /payload:\s*true|recipient:\s*true/);
});

test("worker startup is separate from the web server and health diagnostics are read-only", () => {
  const scripts = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
  const worker = readFileSync(resolve(process.cwd(), "scripts/process-email-outbox.ts"), "utf8");
  const health = readFileSync(resolve(process.cwd(), "scripts/email-worker-health.ts"), "utf8");
  const docs = readFileSync(resolve(process.cwd(), "docs/transactional-email.md"), "utf8");
  assert.equal(scripts.scripts.dev, "next dev");
  assert.equal(scripts.scripts.start, "next start");
  assert.equal(scripts.scripts["email:worker:watch"], "tsx scripts/process-email-outbox.ts --watch");
  assert.match(worker, /catch \(error\)[\s\S]*?safeWorkerFailureCode\(error\)[\s\S]*?will retry/);
  assert.match(worker, /main\(\)\.catch\(\(error: unknown\)[\s\S]*?safeWorkerFailureCode\(error\)/);
  assert.match(worker, /processEmailOutboxBatch\(1, undefined, targetOutboxId\)/);
  assert.match(worker, /writeEmailWorkerHeartbeat/);
  assert.match(health, /readEmailWorkerHeartbeat/);
  assert.match(health, /oldestReadyPendingAgeSeconds/);
  assert.match(health, /recentFailures/);
  assert.match(docs, /email worker-i başlatmır/i);
  assert.match(docs, /email:worker:watch/);
  assert.match(health, /emailOutbox\.groupBy/);
  assert.match(health, /smtpConnectivity:\s*"not-checked"/);
  assert.match(health, /encryptionKey: emailPayloadEncryptionMode\(\)/);
  assert.doesNotMatch(health, /\.update(?:Many)?\(|\.create\(|\.delete(?:Many)?\(/);
});

test("delivery failures map to allowlisted diagnostics without raw text or recipients", () => {
  const secret = "smtp-password-must-not-be-stored";
  const recipient = "private-recipient@example.test";
  const cases = [
    [{ responseCode: 421, command: "MAIL FROM" }, "SMTP_TEMPORARY", "4xx", true],
    [{ responseCode: 450, command: "RCPT TO" }, "SMTP_TEMPORARY", "4xx", true],
    [{ responseCode: 451, command: "RCPT TO" }, "SMTP_TEMPORARY", "4xx", true],
    [{ responseCode: 452, command: "RCPT TO" }, "SMTP_TEMPORARY", "4xx", true],
    [{ responseCode: 550, command: "RCPT TO" }, "SMTP_PERMANENT", "5xx", false],
    [{ responseCode: 553, command: "RCPT TO" }, "SMTP_PERMANENT", "5xx", false],
    [{ responseCode: 554, command: "MAIL FROM" }, "SMTP_PERMANENT", "5xx", false],
    [{ code: "ECONNECTION", command: "EHLO", responseCode: 421 }, "SMTP_TEMPORARY", "4xx", true],
    [{ code: "ECONNECTION", command: "CONN", responseCode: 421 }, "SMTP_TEMPORARY", "4xx", true],
    [{ code: "ETIMEDOUT", command: "CONN" }, "UNKNOWN", null, false],
    [{ code: "ESOCKET", command: "CONN" }, "UNKNOWN", null, false],
    [{ code: "ECONNECTION", command: "CONN" }, "UNKNOWN", null, false],
    [{ code: "ECONNREFUSED", command: "CONN" }, "CONNECTION_REFUSED", null, true],
    [{ code: "ECONNRESET", command: "CONN" }, "CONNECTION_RESET", null, false],
    [{ code: "ECONNRESET", command: "MAIL FROM" }, "CONNECTION_RESET", null, true],
    [{ code: "EPIPE", command: "CONN" }, "CONNECTION_RESET", null, false],
    [{ code: "ECONNRESET", command: "DATA" }, "CONNECTION_RESET", null, false],
    [{ code: "EPIPE", command: "DATA" }, "CONNECTION_RESET", null, false],
    [{ code: "EAI_AGAIN", command: "CONN" }, "DNS_FAILURE", null, true],
    [{ code: "EAI_AGAIN" }, "DNS_FAILURE", null, false],
    [{ code: "ENOTFOUND", command: "CONN" }, "DNS_FAILURE", null, true],
    [{ code: "EDNS", command: "CONN" }, "DNS_FAILURE", null, true],
    [{ code: "ESOCKET", command: "EHLO" }, "NETWORK_ERROR", null, true],
    [{ code: "ESOCKET", command: "DATA" }, "NETWORK_ERROR", null, false],
    [{ code: "ETIMEDOUT", command: "DATA" }, "CONNECTION_TIMEOUT", null, false],
    [{ code: "ETIMEDOUT" }, "CONNECTION_TIMEOUT", null, false],
    [{ code: "ETLS", command: "CONN" }, "TLS_FAILURE", null, true],
    [{ code: "ETLS", command: "STARTTLS", responseCode: 454 }, "SMTP_TEMPORARY", "4xx", true],
    [{ code: "ETLS", command: "STARTTLS" }, "TLS_FAILURE", null, true],
    [{ code: "ETLS" }, "TLS_FAILURE", null, false],
    [{ code: "CERT_HAS_EXPIRED", command: "CONN" }, "TLS_FAILURE", null, false],
    [{ code: "SELF_SIGNED_CERT_IN_CHAIN", command: "STARTTLS" }, "TLS_FAILURE", null, false],
    [{ code: "ESOCKET", command: "STARTTLS", authorizationError: "CERT_HAS_EXPIRED" }, "TLS_FAILURE", null, false],
    [{ code: "EAUTH", command: "AUTH", responseCode: 535 }, "SMTP_AUTHENTICATION", "5xx", false],
    [Object.assign(new Error(secret), { name: "SmtpConfigurationError" }), "SMTP_CONFIGURATION", null, false],
    [{ code: "EMAIL_PAYLOAD_DECRYPT_FAILED" }, "PAYLOAD_DECRYPTION", null, false],
    [{ code: "SOMETHING_NEW", message: secret, recipient }, "UNKNOWN", null, false],
  ] as const;
  for (const [error, category, smtpCodeClass, retryable] of cases) {
    const diagnosis = diagnoseEmailDeliveryFailure(error);
    assert.equal(diagnosis.category, category);
    assert.equal(diagnosis.smtpCodeClass, smtpCodeClass);
    assert.equal(diagnosis.retryable, retryable);
    assert.equal(isSafeEmailRetry(error), retryable);
    const serialized = JSON.stringify(diagnosis);
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes(recipient), false);
    assert.equal("message" in diagnosis, false);
    assert.equal("recipient" in diagnosis, false);
  }
  for (const code of ["ESOCKET", "ETIMEDOUT", "ECONNECTION"]) {
    const ambiguous = diagnoseEmailDeliveryFailure({ code, command: "CONN" });
    assert.equal(ambiguous.category, "UNKNOWN");
    assert.equal(ambiguous.diagnosticCode, "DELIVERY_RESULT_UNKNOWN");
    assert.equal(ambiguous.retryable, false);
  }
  const timeout = { code: "ETIMEDOUT", command: "CONN" };
  assert.equal("responseCode" in timeout, false);
  const timeoutDiagnosis = diagnoseEmailDeliveryFailure(timeout);
  assert.equal(timeoutDiagnosis.category, "UNKNOWN");
  assert.equal(timeoutDiagnosis.smtpCodeClass, null);
  assert.equal(timeoutDiagnosis.diagnosticCode, "DELIVERY_RESULT_UNKNOWN");
  assert.equal(timeoutDiagnosis.retryable, false);
  assert.equal(diagnoseEmailDeliveryFailure({ responseCode: 450 }).diagnosticCode, "SMTP_450");
  assert.equal(diagnoseEmailDeliveryFailure({ code: "ECONNRESET", command: "CONN" }).diagnosticCode, "ECONNRESET");
  assert.equal(diagnoseEmailDeliveryFailure(null).category, "UNKNOWN");
  assert.equal(diagnoseEmailDeliveryFailure(null).retryable, false);
});

test("diagnostic fallback matches only the three new columns and does not send twice", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-chars";
  const encryptedPayload = encryptEmailSecret(JSON.stringify({ name: "Test" }));
  const secret = "raw provider exception and mailbox";
  const columnFormats = [
    (column: string) => column,
    (column: string) => `EmailOutbox.${column}`,
    (column: string) => `public.EmailOutbox.${column}`,
  ];
  const previousError = console.error;
  console.error = () => undefined;
  try {
    assert.equal(isMissingDiagnosticColumn({ code: "P2022" }), false);
    assert.equal(isMissingDiagnosticColumn({ code: "P2022", meta: { column: "sentAt" } }), false);
    assert.equal(isMissingDiagnosticColumn({ code: "P2022", meta: { column: "EmailOutbox.sentAt" } }), false);
    assert.equal(isMissingDiagnosticColumn({ code: "P2022", meta: { column: "failureCategoryExtra" } }), false);
    assert.equal(isMissingDiagnosticColumn({ name: "PrismaClientValidationError" }), false);
    assert.equal(isMissingDiagnosticColumn({ name: "PrismaClientValidationError", message: "Unknown argument `sentAt`. Did you mean `failedAt`?" }), false);
    assert.equal(isMissingDiagnosticColumn({ name: "PrismaClientValidationError", message: "Argument `status` is missing." }), false);
    assert.equal(isMissingDiagnosticColumn({ code: "P1001", meta: { column: "failureCategory" } }), false);
    assert.equal(isMissingDiagnosticColumn({ code: "P2028", message: "Transaction already closed" }), false);
    for (const column of ["failureCategory", "smtpCodeClass", "failedAt"]) {
      for (const format of columnFormats) {
        assert.equal(isMissingDiagnosticColumn({ code: "P2022", meta: { modelName: "EmailOutbox", column: format(column) } }), true);
      }
      assert.equal(isMissingDiagnosticColumn({ name: "PrismaClientValidationError", message: `Unknown argument \`${column}\`. Available options are marked with ?.` }), true);
      assert.equal(isMissingDiagnosticColumn({ name: "PrismaClientValidationError", message: `Unknown argument \`${"\u001b[31m"}${column}${"\u001b[39m"}\`.` }), true);
      const writes: Record<string, unknown>[] = [];
      let updates = 0;
      let sends = 0;
      const database = {
        emailOutbox: {
          updateMany: async ({ where }: { where: { status?: string } }) => ({ count: where.status === "PENDING" ? 1 : 0 }),
          findMany: async () => [{
            id: "diagnostic-row",
            template: "WELCOME_CUSTOMER",
            recipient: "private-recipient@example.test",
            payload: { encrypted: encryptedPayload },
            dedupeKey: "diagnostic-row-event",
            attempts: 0,
            availableAt: new Date(Date.now() - 1_000),
            createdAt: new Date(),
          }],
          update: async ({ data }: { data: Record<string, unknown> }) => {
            updates += 1;
            if (updates === 1) throw { code: "P2022", meta: { column: `EmailOutbox.${column}` } };
            writes.push({ ...data });
            return {};
          },
        },
        emailVerification: { findUnique: async () => null },
        user: { findFirst: async () => null },
      };
      const result = await processEmailOutboxBatch(1, {
        prisma: database as never,
        assertSmtpConfigured: () => undefined,
        sendTransactionalEmail: async () => {
          sends += 1;
          throw Object.assign(new Error(secret), { code: "ECONNECTION", command: "EHLO", responseCode: 421, response: secret });
        },
      });
      assert.deepEqual(result, { processed: 1, sent: 0, failed: 1 });
      assert.equal(sends, 1);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].status, "PENDING");
      assert.equal(writes[0].retrySafe, true);
      assert.equal(writes[0].lastErrorCode, "ECONNECTION");
      assert.equal(writes[0].availableAt instanceof Date, true);
      assert.equal("failureCategory" in writes[0], false);
      assert.equal("smtpCodeClass" in writes[0], false);
      assert.equal("failedAt" in writes[0], false);
      assert.equal(JSON.stringify(writes[0]).includes(secret), false);
      assert.equal(JSON.stringify(writes[0]).includes("private-recipient@example.test"), false);
    }
    const rejected = {
      emailOutbox: {
        updateMany: async ({ where }: { where: { status?: string } }) => ({ count: where.status === "PENDING" ? 1 : 0 }),
        findMany: async () => [{
          id: "unrelated-column",
          template: "WELCOME_CUSTOMER",
          recipient: "private-recipient@example.test",
          payload: { encrypted: encryptedPayload },
          dedupeKey: "unrelated-column-event",
          attempts: 0,
          availableAt: new Date(Date.now() - 1_000),
          createdAt: new Date(),
        }],
        update: async () => { throw { code: "P2022", meta: { column: "EmailOutbox.sentAt" } }; },
      },
      emailVerification: { findUnique: async () => null },
      user: { findFirst: async () => null },
    };
    let unrelatedSends = 0;
    await assert.rejects(() => processEmailOutboxBatch(1, {
      prisma: rejected as never,
      assertSmtpConfigured: () => undefined,
      sendTransactionalEmail: async () => {
        unrelatedSends += 1;
        throw Object.assign(new Error(secret), { code: "ETIMEDOUT", command: "CONN" });
      },
    }));
    assert.equal(unrelatedSends, 1);
  } finally {
    console.error = previousError;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("the fifth temporary failure is terminal and stores only the sanitized category", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-chars";
  const encryptedPayload = encryptEmailSecret(JSON.stringify({ name: "Test" }));
  const writes: Record<string, unknown>[] = [];
  const database = {
    emailOutbox: {
      updateMany: async ({ where }: { where: { status?: string } }) => ({ count: where.status === "PENDING" ? 1 : 0 }),
      findMany: async () => [{
        id: "attempt-limit",
        template: "WELCOME_CUSTOMER",
        recipient: "customer@example.test",
        payload: { encrypted: encryptedPayload },
        dedupeKey: "attempt-limit-event",
        attempts: 4,
        availableAt: new Date(Date.now() - 1_000),
        createdAt: new Date(),
      }],
      update: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return {}; },
    },
    emailVerification: { findUnique: async () => null },
    user: { findFirst: async () => null },
  };
  const previousError = console.error;
  console.error = () => undefined;
  try {
    const exhausted = await processEmailOutboxBatch(1, {
      prisma: database as never,
      assertSmtpConfigured: () => undefined,
      sendTransactionalEmail: async () => { throw Object.assign(new Error("timeout"), { code: "ECONNECTION", command: "EHLO", responseCode: 421 }); },
    });
    assert.equal(exhausted.failed, 1);
    assert.equal(writes.at(-1)?.status, "FAILED");
    assert.equal(writes.at(-1)?.retrySafe, false);
    assert.equal(writes.at(-1)?.failureCategory, "SMTP_TEMPORARY");
    assert.equal(writes.at(-1)?.smtpCodeClass, "4xx");
    assert.ok(writes.at(-1)?.failedAt instanceof Date);
    assert.equal(JSON.stringify(writes.at(-1)).includes("customer@example.test"), false);
    assert.equal(JSON.stringify(writes.at(-1)).includes("timeout"), false);
  } finally {
    console.error = previousError;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("a validation error for a diagnostic field falls back and an unrelated validation error does not", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-chars";
  const encryptedPayload = encryptEmailSecret(JSON.stringify({ name: "Test" }));
  const previousError = console.error;
  console.error = () => undefined;
  const row = {
    id: "validation-row",
    template: "WELCOME_CUSTOMER",
    recipient: "private-recipient@example.test",
    payload: { encrypted: encryptedPayload },
    dedupeKey: "validation-row-event",
    attempts: 0,
    availableAt: new Date(Date.now() - 1_000),
    createdAt: new Date(),
  };
  try {
    for (const column of ["failureCategory", "smtpCodeClass", "failedAt"]) {
      const writes: Record<string, unknown>[] = [];
      let updates = 0;
      let sends = 0;
      const database = {
        emailOutbox: {
          updateMany: async ({ where }: { where: { status?: string } }) => ({ count: where.status === "PENDING" ? 1 : 0 }),
          findMany: async () => [row],
          update: async ({ data }: { data: Record<string, unknown> }) => {
            updates += 1;
            if (updates === 1) throw { name: "PrismaClientValidationError", message: `Unknown argument \`${column}\`.` };
            writes.push(data);
            return {};
          },
        },
        emailVerification: { findUnique: async () => null },
        user: { findFirst: async () => null },
      };
      await processEmailOutboxBatch(1, {
        prisma: database as never,
        assertSmtpConfigured: () => undefined,
        sendTransactionalEmail: async () => {
          sends += 1;
          throw Object.assign(new Error("timeout"), { code: "ECONNECTION", command: "EHLO", responseCode: 421 });
        },
      });
      assert.equal(sends, 1);
      assert.equal(writes.length, 1);
      assert.equal("failureCategory" in writes[0], false);
      assert.equal(writes[0].lastErrorCode, "ECONNECTION");
    }
    let unrelatedSends = 0;
    await assert.rejects(() => processEmailOutboxBatch(1, {
      prisma: {
        emailOutbox: {
          updateMany: async ({ where }: { where: { status?: string } }) => ({ count: where.status === "PENDING" ? 1 : 0 }),
          findMany: async () => [row],
          update: async () => { throw { name: "PrismaClientValidationError", message: "Unknown argument `sentAt`." }; },
        },
        emailVerification: { findUnique: async () => null },
        user: { findFirst: async () => null },
      } as never,
      assertSmtpConfigured: () => undefined,
      sendTransactionalEmail: async () => {
        unrelatedSends += 1;
        throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT", command: "CONN" });
      },
    }));
    assert.equal(unrelatedSends, 1);
  } finally {
    console.error = previousError;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("a failed SENT write leaves the claimed row unchanged and does not send again", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-chars";
  const encryptedPayload = encryptEmailSecret(JSON.stringify({ name: "Test" }));
  const secret = "database connection string must stay out of the log";
  const updates: Record<string, unknown>[] = [];
  let sends = 0;
  const logs: unknown[] = [];
  const previousError = console.error;
  console.error = (...args: unknown[]) => { logs.push(args); };
  const database = {
    emailOutbox: {
      updateMany: async ({ where }: { where: { status?: string } }) => ({ count: where.status === "PENDING" ? 1 : 0 }),
      findMany: async () => [{
        id: "accepted-row",
        template: "WELCOME_CUSTOMER",
        recipient: "customer@example.test",
        payload: { encrypted: encryptedPayload },
        dedupeKey: "accepted-row-event",
        attempts: 1,
        availableAt: new Date(Date.now() - 1_000),
        createdAt: new Date(),
      }],
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        throw Object.assign(new Error(secret), { code: "P1001" });
      },
    },
    emailVerification: { findUnique: async () => null },
    user: { findFirst: async () => null },
  };
  try {
    await assert.rejects(() => processEmailOutboxBatch(1, {
      prisma: database as never,
      assertSmtpConfigured: () => undefined,
      sendTransactionalEmail: async () => { sends += 1; },
    }), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "DELIVERY_RESULT_UNKNOWN");
      assert.equal(error instanceof Error && error.message.includes(secret), false);
      return true;
    });
    assert.equal(sends, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].status, "SENT");
    assert.equal(updates.some(update => update.status === "FAILED" || update.status === "PENDING"), false);
    assert.equal(JSON.stringify(logs).includes(secret), false);
    assert.equal(JSON.stringify(logs).includes("DELIVERY_RESULT_UNKNOWN"), true);
  } finally {
    console.error = previousError;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("failure timestamps follow the unresolved-failure lifecycle and success clears them", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-chars";
  const encryptedPayload = encryptEmailSecret(JSON.stringify({ name: "Test" }));
  const claims: Record<string, unknown>[] = [];
  const writes: Record<string, unknown>[] = [];
  let sends = 0;
  const state = { status: "PENDING", attempts: 0, availableAt: new Date(Date.now() - 1_000) };
  const database = {
    emailOutbox: {
      updateMany: async ({ where, data }: { where: { status?: string }; data?: Record<string, unknown> }) => {
        if (where.status === "PROCESSING") return { count: 0 };
        if (where.status !== "PENDING" || state.status !== "PENDING") return { count: 0 };
        claims.push(data ?? {});
        state.status = "PROCESSING";
        state.attempts += 1;
        return { count: 1 };
      },
      findMany: async () => state.status === "PENDING" && state.availableAt <= new Date() ? [{
        id: "lifecycle-row",
        template: "WELCOME_CUSTOMER",
        recipient: "customer@example.test",
        payload: { encrypted: encryptedPayload },
        dedupeKey: "lifecycle-row-event",
        attempts: state.attempts,
        availableAt: state.availableAt,
        createdAt: new Date(),
      }] : [],
      update: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        state.status = String(data.status);
        if (data.availableAt instanceof Date) state.availableAt = data.availableAt;
        return {};
      },
    },
    emailVerification: { findUnique: async () => null },
    user: { findFirst: async () => null },
  };
  const previousError = console.error;
  console.error = () => undefined;
  try {
    const failed = await processEmailOutboxBatch(1, {
      prisma: database as never,
      assertSmtpConfigured: () => undefined,
      sendTransactionalEmail: async () => { sends += 1; throw Object.assign(new Error("timeout"), { code: "ECONNECTION", command: "EHLO", responseCode: 421 }); },
    });
    assert.equal(failed.failed, 1);
    assert.equal(writes[0].status, "PENDING");
    assert.equal(writes[0].retrySafe, true);
    assert.equal(writes[0].failureCategory, "SMTP_TEMPORARY");
    assert.ok(writes[0].failedAt instanceof Date);
    const claimedAt = claims[0];
    state.availableAt = new Date(Date.now() - 1_000);
    const sent = await processEmailOutboxBatch(1, {
      prisma: database as never,
      assertSmtpConfigured: () => undefined,
      sendTransactionalEmail: async () => { sends += 1; },
    });
    assert.equal(sent.sent, 1);
    assert.equal(sends, 2);
    assert.equal(claims[1].failureCategory, null);
    assert.equal(claims[1].smtpCodeClass, null);
    assert.equal(claims[1].failedAt, null);
    assert.equal(writes.at(-1)?.status, "SENT");
    assert.equal(writes.at(-1)?.failureCategory, null);
    assert.equal(writes.at(-1)?.smtpCodeClass, null);
    assert.equal(writes.at(-1)?.failedAt, null);
    assert.equal(claimedAt.failureCategory, null);
  } finally {
    console.error = previousError;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("manual admin retry clears diagnostic fields and still works when those columns are absent", async () => {
  const calls: Record<string, unknown>[] = [];
  let attempts = 0;
  const database = {
    emailOutbox: {
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        attempts += 1;
        if (attempts === 1) throw { code: "P2022", meta: { column: "public.EmailOutbox.failedAt" } };
        calls.push(data);
        return { count: 1 };
      },
    },
  };
  const updated = await requeueRetrySafeOutbox(database as never, "retry-row");
  assert.equal(updated.count, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, "PENDING");
  assert.equal(calls[0].retrySafe, false);
  assert.equal(calls[0].lastErrorCode, null);
  assert.equal(calls[0].lockedAt, null);
  assert.equal("failureCategory" in calls[0], false);
  assert.equal("smtpCodeClass" in calls[0], false);
  assert.equal("failedAt" in calls[0], false);
  await assert.rejects(() => requeueRetrySafeOutbox({
    emailOutbox: { updateMany: async () => { throw { code: "P2022", meta: { column: "sentAt" } }; } },
  } as never, "retry-row"));
  await assert.rejects(() => requeueRetrySafeOutbox({
    emailOutbox: { updateMany: async () => { throw { code: "P1001" }; } },
  } as never, "retry-row"));
});

test("email diagnostic migration is additive and does not rewrite existing rows", () => {
  const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261104191500_email_failure_diagnostics/migration.sql"), "utf8");
  const statements = sql.replace(/--.*$/gm, "");
  assert.match(sql, /ADD COLUMN "failureCategory" TEXT/);
  assert.match(sql, /ADD COLUMN "smtpCodeClass" TEXT/);
  assert.match(sql, /ADD COLUMN "failedAt" TIMESTAMP\(3\)/);
  assert.match(sql, /"failureCategory" IS NULL/);
  assert.match(sql, /"smtpCodeClass" IS NULL OR "smtpCodeClass" IN \('4xx', '5xx'\)/);
  assert.doesNotMatch(statements, /\b(UPDATE|DELETE|TRUNCATE|DROP TABLE|INSERT)\b/i);
  assert.doesNotMatch(sql, /2026-10-09/);
});
