import assert from "node:assert/strict";
import test from "node:test";
import {
  conversationContextKey,
  customerDisplayName,
  findContactDetails,
  isReportReason,
  MESSAGE_EMAIL_WINDOW_MS,
  MESSAGE_LIMITS,
  messageEmailEventKey,
  messagePreview,
  MESSAGING_LIMIT_DEFAULTS,
  MESSAGING_TEXT,
  MESSAGING_WINDOWS,
  validateMessageBody,
} from "../lib/messaging";

test("contact details: phone numbers and e-mail addresses are found", () => {
  for (const text of [
    "Salam, 050 123 45 67 nömrəsinə zəng edin",
    "Nömrəm 0501234567",
    "+994 55 123 45 67",
    "994501234567",
    "501234567",
    "Tel: 055-123-45-67",
    "(050) 123 45 67",
    "012 345 67 89",
    "2 ədəd, 050 123 45 67",
    "1 050 123 45 67",
    "+44 20 7946 0958",
  ]) assert.equal(findContactDetails(text), "PHONE", text);
  for (const text of ["yaz: test@mail.az", "Ad.Soyad+shop@example.co.uk", "e-poçt: a@b.az ünvanına"]) assert.equal(findContactDetails(text), "EMAIL", text);
});

test("contact details: order codes, prices, sizes, dates and bare 9-digit codes are not refused", () => {
  for (const text of [
    "Sifariş #AB12CD34 haqqında",
    "Qiymət 1 299.90 AZN",
    "Tracking 123456789",
    "Ölçü 42, rəng qara",
    "Kod 2026 11 16 12",
    "Sifariş 12 ədəd 3 qutu",
    "Çatdırılma 16.11.2026 tarixində",
    "Endirim 15%, cəmi 120 AZN",
    "@mağaza salam",
  ]) assert.equal(findContactDetails(text), null, text);
});

test("message body: trimmed, CRLF normalized, blank lines collapsed, 1-1000 characters", () => {
  assert.deepEqual(validateMessageBody("  Salam!\r\n\r\n\r\n\r\nNecəsiniz?  ", { allowContactDetails: false }), { ok: true, body: "Salam!\n\nNecəsiniz?" });
  assert.deepEqual(validateMessageBody("a", { allowContactDetails: false }), { ok: true, body: "a" });
  assert.equal(validateMessageBody("x".repeat(MESSAGE_LIMITS.bodyMax), { allowContactDetails: false }).ok, true);
  const long = validateMessageBody("x".repeat(MESSAGE_LIMITS.bodyMax + 1), { allowContactDetails: false });
  assert.deepEqual(long, { ok: false, code: "TOO_LONG", message: MESSAGING_TEXT.bodyTooLong });
  for (const value of ["", "   \n\t  ", null, undefined, 42, {}]) assert.equal((validateMessageBody(value, { allowContactDetails: false }) as { code?: string }).code, "REQUIRED", String(value));
  assert.equal((validateMessageBody("salam\u0000", { allowContactDetails: false }) as { code?: string }).code, "INVALID");
  assert.equal(validateMessageBody("tab\tbreak\nok", { allowContactDetails: false }).ok, true);
});

test("message body: contact details refused by default, allowed when the setting is on", () => {
  const refused = validateMessageBody("Zəng edin: 050 123 45 67", { allowContactDetails: false });
  assert.deepEqual(refused, { ok: false, code: "CONTACT_DETAILS", message: MESSAGING_TEXT.contactDetails });
  assert.deepEqual(validateMessageBody("Zəng edin: 050 123 45 67", { allowContactDetails: true }), { ok: true, body: "Zəng edin: 050 123 45 67" });
});

test("context key: one thread per customer, store and context", () => {
  assert.equal(conversationContextKey("STORE"), "store");
  assert.equal(conversationContextKey("STORE", "ignored"), "store");
  assert.equal(conversationContextKey("PRODUCT", "p1"), "product:p1");
  assert.equal(conversationContextKey("ORDER", "so-1"), "order:so-1");
  for (const bad of [undefined, null, "", "a b", "x".repeat(65), "../x"]) assert.throws(() => conversationContextKey("PRODUCT", bad), /MESSAGING_CONTEXT_ID_INVALID/, String(bad));
});

test("display name: first name and initial, never contact details", () => {
  assert.equal(customerDisplayName("Aysel", "Məmmədova"), "Aysel M.");
  assert.equal(customerDisplayName("  Aysel  Nur ", "əliyeva"), "Aysel Ə.");
  assert.equal(customerDisplayName("Aysel", ""), "Aysel");
  assert.equal(customerDisplayName("", "Məmmədova"), "Müştəri");
  assert.equal(customerDisplayName(null, null), "Müştəri");
});

test("preview: one line, at most 140 characters", () => {
  assert.equal(messagePreview("Salam\n\nNecəsiniz?"), "Salam Necəsiniz?");
  const preview = messagePreview("x".repeat(500));
  assert.equal(preview.length, MESSAGE_LIMITS.previewMax);
  assert.ok(preview.endsWith("…"));
});

test("e-mail throttle: one event key per conversation, recipient side and 15-minute window", () => {
  const start = Date.UTC(2026, 10, 16, 10, 0, 0);
  assert.equal(MESSAGE_EMAIL_WINDOW_MS, 15 * 60 * 1000);
  assert.equal(messageEmailEventKey("c1", "STORE", start), messageEmailEventKey("c1", "STORE", start + MESSAGE_EMAIL_WINDOW_MS - 1));
  assert.notEqual(messageEmailEventKey("c1", "STORE", start), messageEmailEventKey("c1", "STORE", start + MESSAGE_EMAIL_WINDOW_MS));
  assert.notEqual(messageEmailEventKey("c1", "STORE", start), messageEmailEventKey("c1", "CUSTOMER", start));
  assert.notEqual(messageEmailEventKey("c1", "STORE", start), messageEmailEventKey("c2", "STORE", start));
  assert.equal(messageEmailEventKey("c1", "STORE", new Date(start)), messageEmailEventKey("c1", "STORE", start));
});

test("limits: owner defaults and windows; report reasons", () => {
  assert.deepEqual(MESSAGING_LIMIT_DEFAULTS, { customerMessagesPerHour: 30, customerNewConversationsPerDay: 10, storeMessagesPerHour: 200, storeIncomingPerHour: 120 });
  assert.equal(MESSAGING_WINDOWS.customerNewConversationsPerDay, 24 * 60 * 60 * 1000);
  assert.equal(MESSAGING_WINDOWS.customerMessagesPerHour, 60 * 60 * 1000);
  for (const reason of ["SPAM", "ABUSE", "FRAUD", "OTHER"]) assert.equal(isReportReason(reason), true, reason);
  for (const reason of ["spam", "", null, "toString", "__proto__"]) assert.equal(isReportReason(reason), false, String(reason));
});
