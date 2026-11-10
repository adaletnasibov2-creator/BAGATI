import assert from "node:assert/strict";
import test from "node:test";
import { toTelephoneHref, toWhatsAppHref } from "../lib/public-contact-links";

test("WhatsApp links normalize international numbers to E.164 digits", () => {
  assert.equal(toWhatsAppHref("+994 (50) 123-45-67"), "https://wa.me/994501234567");
  assert.equal(toWhatsAppHref("00 994 50 123 45 67"), "https://wa.me/994501234567");
});

test("WhatsApp links reject missing, local-only, malformed, and out-of-range numbers", () => {
  for (const phone of [null, undefined, "", "050 123 45 67", "+00012345678", "+12", "+1234567890123456", "call me +994501234567"]) {
    assert.equal(toWhatsAppHref(phone), null, String(phone));
  }
});

test("telephone links preserve valid local and international contact numbers", () => {
  assert.equal(toTelephoneHref("050 123 45 67"), "tel:0501234567");
  assert.equal(toTelephoneHref("+994 (50) 123-45-67"), "tel:+994501234567");
  assert.equal(toTelephoneHref("00 994 50 123 45 67"), "tel:+994501234567");
  assert.equal(toTelephoneHref("call me"), null);
});
