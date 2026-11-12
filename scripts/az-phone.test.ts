import assert from "node:assert/strict";
import test from "node:test";
import { AZ_PHONE_ERROR, buildTelHref, buildWhatsAppUrl, normalizeAzPhone, optionalAzPhoneSchema } from "../lib/az-phone";

const expected = { e164: "+994557614332", digits: "994557614332", display: "+994 55 761 43 32", mobile: true };

test("every accepted Azerbaijani input shape normalizes to the same E.164 number", () => {
  for (const input of [
    "0557614332", "055 761 43 32", "055-761-43-32", "(055) 761-43-32", "055.761.43.32",
    "557614332", "55 761 43 32",
    "+994557614332", "+994 55 761 43 32", "+994 (55) 761-43-32", "+994-55-761-43-32",
    "994557614332", "994 55 761 43 32",
    "00994557614332", "00 994 55 761 43 32",
    "  +994 55 761 43 32  ", "0557614332\n", "055 761 43 32",
  ]) {
    assert.deepEqual(normalizeAzPhone(input), expected, JSON.stringify(input));
  }
});

test("all mobile operator codes are mobile; fixed lines normalize but are not mobile", () => {
  for (const code of ["10", "50", "51", "55", "60", "70", "77", "99"]) {
    assert.equal(normalizeAzPhone(`0${code}1234567`)?.mobile, true, code);
  }
  assert.deepEqual(normalizeAzPhone("012 555 12 34"), { e164: "+994125551234", digits: "994125551234", display: "+994 12 555 12 34", mobile: false });
  assert.equal(normalizeAzPhone("+994 22 255 12 34")?.mobile, false);
  assert.equal(normalizeAzPhone("036 544 12 34")?.mobile, false);
});

test("invalid input is rejected", () => {
  for (const input of [
    null, undefined, "", "   ", "abc", "055 761 43 3", "055 761 43 321", "+7 912 345 67 89", "+1 555 123 4567",
    "0057614332", "457614332", "05 5761 4332x", "055 761 43 32 ext 5", "+994 55 761 43 32 55", "+99455761433",
    "javascript:alert(1)", "tel:+994557614332", "＋994557614332", "055\n7614332", "055\t761 43 32", "1".repeat(41),
    "+994 33 123 45 67", "+994 40 123 45 67", "++994557614332", "994 55 761 43 3",
  ]) {
    assert.equal(normalizeAzPhone(input as string), null, JSON.stringify(input));
  }
});

test("WhatsApp link uses E.164 digits and a prefilled Azerbaijani text with the store name", () => {
  const url = buildWhatsAppUrl("055 761 43 32", "Qazax  Ev Dünyası");
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://wa.me");
  assert.equal(parsed.pathname, "/994557614332");
  assert.equal(parsed.searchParams.get("text"), "Salam! BAGATI-dakı “Qazax Ev Dünyası” mağazanız haqqında yazıram.");
});

test("no WhatsApp link for invalid or fixed-line numbers; tel link only for valid numbers", () => {
  assert.equal(buildWhatsAppUrl("not a phone", "Mağaza"), null);
  assert.equal(buildWhatsAppUrl("012 555 12 34", "Mağaza"), null);
  assert.equal(buildWhatsAppUrl(null, "Mağaza"), null);
  assert.equal(buildTelHref("012 555 12 34"), "tel:+994125551234");
  assert.equal(buildTelHref("055 761 43 32"), "tel:+994557614332");
  assert.equal(buildTelHref("call me"), null);
});

test("save schema: empty becomes null, valid becomes E.164, invalid fails with an Azerbaijani message", () => {
  assert.equal(optionalAzPhoneSchema.parse(""), null);
  assert.equal(optionalAzPhoneSchema.parse("   "), null);
  assert.equal(optionalAzPhoneSchema.parse(null), null);
  assert.equal(optionalAzPhoneSchema.parse("055 761 43 32"), "+994557614332");
  const failed = optionalAzPhoneSchema.safeParse("12345");
  assert.equal(failed.success, false);
  assert.equal(failed.success ? "" : failed.error.issues[0]?.message, AZ_PHONE_ERROR);
});
