import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  base32Decode, base32Encode, formatManualKey, hotp, normalizeTotpCode, otpauthUri, totpAt, totpStep, verifyTotp,
} from "../lib/totp";
import { admin2faKeyStatus, Admin2faKeyError, decryptTotpSecret, encryptTotpSecret } from "../lib/admin-2fa-crypto";
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode, verifyRecoveryCode, RECOVERY_CODE_COUNT } from "../lib/admin-recovery-codes";
import {
  ADMIN_2FA_LOCK_MS, ADMIN_2FA_MAX_FAILURES, adminLoginNextStep, adminMayUseSession, afterFailedSecondFactor, isAdmin2faRequired, isSecondFactorLocked,
} from "../lib/admin-2fa-policy";
import { encodeQr, qrSvg } from "../lib/qr-code";

// ---------- RFC 4226 / RFC 6238 ----------

test("HOTP matches the RFC 4226 appendix D vectors", () => {
  const key = Buffer.from("12345678901234567890");
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  expected.forEach((code, counter) => assert.equal(hotp(key, counter), code, `counter ${counter}`));
});

test("TOTP matches the RFC 6238 appendix B vectors (8 digits, SHA-1/256/512)", () => {
  const keys = {
    sha1: Buffer.from("12345678901234567890"),
    sha256: Buffer.from("12345678901234567890123456789012"),
    sha512: Buffer.from("1234567890123456789012345678901234567890123456789012345678901234"),
  } as const;
  const vectors: [number, string, string, string][] = [
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"],
  ];
  for (const [seconds, sha1, sha256, sha512] of vectors) {
    assert.equal(totpAt(keys.sha1, seconds * 1000, { digits: 8 }), sha1, `sha1 T=${seconds}`);
    assert.equal(totpAt(keys.sha256, seconds * 1000, { digits: 8, algorithm: "sha256" }), sha256, `sha256 T=${seconds}`);
    assert.equal(totpAt(keys.sha512, seconds * 1000, { digits: 8, algorithm: "sha512" }), sha512, `sha512 T=${seconds}`);
  }
  // The 6-digit code used by authenticator apps is the last 6 digits of the same truncation.
  assert.equal(totpAt(keys.sha1, 59_000), "287082");
});

test("base32 round-trips and decodes the RFC 4648 vectors", () => {
  assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
  assert.equal(base32Decode("MZXW6YTBOI")?.toString(), "foobar");
  assert.equal(base32Decode("mzxw 6ytb-oi======")?.toString(), "foobar");
  assert.equal(base32Decode("MZXW1"), null);
  for (let i = 0; i < 20; i += 1) {
    const bytes = randomBytes(20);
    assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  }
  assert.match(formatManualKey(Buffer.alloc(20)), /^(AAAA ){7}AAAA$/);
});

test("TOTP accepts the previous, current and next step only", () => {
  const key = randomBytes(20);
  const now = 1_800_000_000_000;
  const step = totpStep(now);
  for (const offset of [-1, 0, 1]) {
    const result = verifyTotp({ key, code: hotp(key, step + offset), nowMs: now, lastUsedStep: null });
    assert.deepEqual(result, { ok: true, step: step + offset }, `offset ${offset}`);
  }
  for (const offset of [-3, -2, 2, 3]) {
    assert.deepEqual(verifyTotp({ key, code: hotp(key, step + offset), nowMs: now, lastUsedStep: null }), { ok: false, reason: "mismatch" }, `offset ${offset}`);
  }
});

test("TOTP rejects replays: a used step and every older step are refused", () => {
  const key = randomBytes(20);
  const now = 1_800_000_000_000;
  const step = totpStep(now);
  const code = hotp(key, step);
  const first = verifyTotp({ key, code, nowMs: now, lastUsedStep: null });
  assert.deepEqual(first, { ok: true, step });
  assert.deepEqual(verifyTotp({ key, code, nowMs: now, lastUsedStep: step }), { ok: false, reason: "replay" });
  assert.deepEqual(verifyTotp({ key, code: hotp(key, step - 1), nowMs: now, lastUsedStep: step }), { ok: false, reason: "replay" });
  assert.deepEqual(verifyTotp({ key, code: hotp(key, step + 1), nowMs: now, lastUsedStep: step }), { ok: true, step: step + 1 });
});

test("TOTP code format is validated before any comparison", () => {
  const key = randomBytes(20);
  for (const code of ["", "12345", "1234567", "abcdef", null, 123456, "12 34 5"]) {
    assert.deepEqual(verifyTotp({ key, code, nowMs: Date.now(), lastUsedStep: null }), { ok: false, reason: "format" }, String(code));
  }
  assert.equal(normalizeTotpCode(" 123 456 "), "123456");
  assert.equal(normalizeTotpCode("123-456"), "123456");
});

test("otpauth URI carries issuer, account, SHA1, 6 digits and 30s", () => {
  const uri = otpauthUri({ issuer: "BAGATI", account: "admin@shopbagati.com", secret: Buffer.from("12345678901234567890") });
  assert.equal(uri, "otpauth://totp/BAGATI:admin%40shopbagati.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=BAGATI&algorithm=SHA1&digits=6&period=30");
});

// ---------- Encryption ----------

const KEY = randomBytes(32).toString("base64");

test("TOTP secret encryption round-trips and is bound to the user", () => {
  const env = { BAGATI_ADMIN_2FA_KEY: KEY };
  const secret = randomBytes(20);
  const sealed = encryptTotpSecret(secret, "user-a", env);
  assert.match(sealed, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
  assert.doesNotMatch(sealed, new RegExp(base32Encode(secret)));
  assert.deepEqual(decryptTotpSecret(sealed, "user-a", env), secret);
  assert.notEqual(encryptTotpSecret(secret, "user-a", env), sealed, "random IV");
  assert.throws(() => decryptTotpSecret(sealed, "user-b", env), "AAD binds the ciphertext to the user");
  const [v, iv, tag, ct] = sealed.split(".");
  const flipped = Buffer.from(ct, "base64url"); flipped[0] ^= 1;
  assert.throws(() => decryptTotpSecret([v, iv, tag, flipped.toString("base64url")].join("."), "user-a", env), "tampering is detected");
  assert.throws(() => decryptTotpSecret(sealed, "user-a", { BAGATI_ADMIN_2FA_KEY: randomBytes(32).toString("base64") }), "wrong key fails");
  // Hex form of the same key works too.
  assert.deepEqual(decryptTotpSecret(sealed, "user-a", { BAGATI_ADMIN_2FA_KEY: Buffer.from(KEY, "base64").toString("hex") }), secret);
});

test("a missing or invalid key disables encryption and never falls back to SESSION_SECRET", () => {
  const session = { SESSION_SECRET: "s".repeat(48) };
  assert.equal(admin2faKeyStatus(session), "missing");
  assert.equal(admin2faKeyStatus({ ...session, BAGATI_ADMIN_2FA_KEY: "  " }), "missing");
  assert.equal(admin2faKeyStatus({ ...session, BAGATI_ADMIN_2FA_KEY: randomBytes(16).toString("base64") }), "invalid");
  assert.equal(admin2faKeyStatus({ ...session, BAGATI_ADMIN_2FA_KEY: "not base64 !!" }), "invalid");
  assert.equal(admin2faKeyStatus({ SESSION_SECRET: KEY, BAGATI_ADMIN_2FA_KEY: KEY }), "invalid", "a copy of SESSION_SECRET is refused");
  assert.equal(admin2faKeyStatus({ ...session, BAGATI_ADMIN_2FA_KEY: KEY }), "configured");
  assert.throws(() => encryptTotpSecret(randomBytes(20), "u", session), (error: unknown) => error instanceof Admin2faKeyError && error.status === "missing");
  assert.throws(() => decryptTotpSecret("v1.a.b.c", "u", session), Admin2faKeyError);
});

// ---------- Recovery codes ----------

test("recovery codes: 10 unique codes, normalized input, slow single-hash verification", async () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, RECOVERY_CODE_COUNT);
  assert.equal(new Set(codes).size, RECOVERY_CODE_COUNT);
  for (const code of codes) assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  const hash = await hashRecoveryCode(codes[0]);
  assert.match(hash, /^scrypt\$14\$8\$1\$[\w-]+\$[\w-]+$/);
  assert.equal(hash.includes(codes[0].replace("-", "")), false);
  assert.equal(await verifyRecoveryCode(codes[0], hash), true);
  assert.equal(await verifyRecoveryCode(codes[0].toLowerCase().replace("-", " "), hash), true, "case and separators are ignored");
  assert.equal(await verifyRecoveryCode(codes[1], hash), false);
  assert.equal(await verifyRecoveryCode("not-a-code", hash), false);
  assert.notEqual(await hashRecoveryCode(codes[0]), hash, "per-code salt");
  assert.equal(normalizeRecoveryCode("abcde-fghjk"), "ABCDEFGHJK");
  assert.equal(normalizeRecoveryCode("O0IL1-22222"), "00111" + "22222", "look-alikes are mapped");
  assert.equal(normalizeRecoveryCode("ABCDE-FGHJ"), null);
});

// ---------- Policy ----------

test("rollout flag defaults to optional 2FA", () => {
  assert.equal(isAdmin2faRequired({}), false);
  assert.equal(isAdmin2faRequired({ BAGATI_ADMIN_2FA_REQUIRED: "false" }), false);
  assert.equal(isAdmin2faRequired({ BAGATI_ADMIN_2FA_REQUIRED: "1" }), false);
  assert.equal(isAdmin2faRequired({ BAGATI_ADMIN_2FA_REQUIRED: " TRUE " }), true);
});

test("after the password: enrolled admins always need a code; required mode forces enrollment", () => {
  assert.equal(adminLoginNextStep({ enrolled: false, required: false, keyStatus: "missing" }), "session", "today's behaviour keeps working without the key");
  assert.equal(adminLoginNextStep({ enrolled: false, required: false, keyStatus: "configured" }), "session");
  assert.equal(adminLoginNextStep({ enrolled: true, required: false, keyStatus: "configured" }), "code");
  assert.equal(adminLoginNextStep({ enrolled: true, required: false, keyStatus: "missing" }), "code", "enforced for enrolled admins; recovery codes still work");
  assert.equal(adminLoginNextStep({ enrolled: false, required: true, keyStatus: "configured" }), "enroll");
  assert.equal(adminLoginNextStep({ enrolled: false, required: true, keyStatus: "missing" }), "blocked-key-missing");
  assert.equal(adminMayUseSession({ required: true, enrolled: false }), false);
  assert.equal(adminMayUseSession({ required: true, enrolled: true }), true);
  assert.equal(adminMayUseSession({ required: false, enrolled: false }), true);
});

test("lockout after 5 consecutive wrong codes for 15 minutes, then the counter restarts", () => {
  const now = new Date("2026-11-13T10:00:00Z");
  let state = { failedAttempts: 0, lockedUntil: null as Date | null };
  for (let i = 1; i < ADMIN_2FA_MAX_FAILURES; i += 1) {
    const next = afterFailedSecondFactor(state, now);
    assert.equal(next.lockedNow, false);
    assert.equal(next.failedAttempts, i);
    state = next;
  }
  const locked = afterFailedSecondFactor(state, now);
  assert.equal(locked.lockedNow, true);
  assert.equal(locked.lockedUntil?.getTime(), now.getTime() + ADMIN_2FA_LOCK_MS);
  assert.equal(isSecondFactorLocked(locked, now), true);
  assert.equal(isSecondFactorLocked(locked, new Date(now.getTime() + ADMIN_2FA_LOCK_MS - 1)), true);
  const later = new Date(now.getTime() + ADMIN_2FA_LOCK_MS);
  assert.equal(isSecondFactorLocked(locked, later), false);
  const afterExpiry = afterFailedSecondFactor(locked, later);
  assert.equal(afterExpiry.failedAttempts, 1);
  assert.equal(afterExpiry.lockedUntil, null);
});

// ---------- QR ----------

test("QR encoder produces a valid structure and an SVG without external references", () => {
  const matrix = encodeQr("otpauth://totp/BAGATI:a%40b.az?secret=ABC&issuer=BAGATI");
  assert.equal((matrix.length - 17) % 4, 0);
  assert.ok(matrix.every((row) => row.length === matrix.length));
  // Finder pattern corners are dark, separator light.
  for (const [x, y] of [[0, 0], [matrix.length - 1, 0], [0, matrix.length - 1]]) assert.equal(matrix[y][x], true);
  assert.equal(matrix[7][7], false);
  const svg = qrSvg("hello", { title: "<x>" });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 29 29"/);
  assert.doesNotMatch(svg, /href|<script|<x>/);
});
