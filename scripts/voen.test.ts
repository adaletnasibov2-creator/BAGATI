import assert from "node:assert/strict";
import test from "node:test";
import { isValidVoen, maskVoenDigits, parseVoen, VOEN_HELP, VOEN_MESSAGES, voenKindLabel } from "../lib/voen";

test("valid: 10 ASCII digits ending in 1 (legal entity) or 2 (natural person)", () => {
  assert.deepEqual(parseVoen("1234567891"), { ok: true, voen: "1234567891", kind: "LEGAL_ENTITY" });
  assert.deepEqual(parseVoen("9876543212"), { ok: true, voen: "9876543212", kind: "NATURAL_PERSON" });
  assert.equal(voenKindLabel("LEGAL_ENTITY"), "Hüquqi şəxs");
  assert.equal(voenKindLabel("NATURAL_PERSON"), "Fiziki şəxs / fərdi sahibkar");
});

test("spaces of any kind are removed (incl. tab, no-break, zero-width, BOM, around and inside)", () => {
  for (const input of [" 1234567891 ", "12 345 678 91", "123\t456\n7891", "1234 567891", "1234 567891", "﻿1234567891", "1234​567891", "1234　567891"]) {
    assert.deepEqual(parseVoen(input), { ok: true, voen: "1234567891", kind: "LEGAL_ENTITY" }, JSON.stringify(input));
  }
});

test("invalid: empty, wrong characters, non-ASCII digits, wrong length, wrong last digit", () => {
  const code = (input: unknown) => { const result = parseVoen(input); return result.ok ? "OK" : result.code; };
  for (const input of [undefined, null, 1234567891, "", "   ", " \t﻿"]) assert.equal(code(input), "EMPTY", JSON.stringify(input));
  for (const input of ["12-345-678-91", "AZ12345678", "1234567891a", "123456789.1", "+1234567891", "１２３４５６７８９１", "١٢٣٤٥٦٧٨٩١", "۱۲۳۴۵۶۷۸۹۱", "१२३४५६७८९१"]) {
    assert.equal(code(input), "CHARACTERS", input);
  }
  for (const input of ["123456789", "12345678911", "1", "123456789012"]) assert.equal(code(input), "LENGTH", input);
  for (const input of ["1234567890", "1234567893", "1234567899", "0000000000"]) assert.equal(code(input), "LAST_DIGIT", input);
  assert.equal(isValidVoen("1234567890"), false);
  assert.equal(isValidVoen("1234567892"), true);
});

test("messages are Azerbaijani and never claim the number is registered", () => {
  assert.equal(VOEN_MESSAGES.LENGTH, "VÖEN 10 rəqəmdən ibarət olmalıdır.");
  assert.match(VOEN_MESSAGES.LAST_DIGIT, /sonuncu rəqəmi 1 \(hüquqi şəxs\) və ya 2 \(fiziki şəxs \/ fərdi sahibkar\)/);
  assert.match(VOEN_HELP, /^10 rəqəm, sonuncu rəqəm 1 və ya 2\./);
  for (const text of [...Object.values(VOEN_MESSAGES), VOEN_HELP]) assert.doesNotMatch(text, /etibarlı|həqiqi|real|mövcud/i);
});

test("masking keeps only the last three digits", () => {
  assert.equal(maskVoenDigits("1234567891"), "•••••••891");
  assert.equal(maskVoenDigits(null), "—");
});
