/**
 * DEPS-UPDATE-1: security patch upgrade of next (15.5.27 -> 15.5.29) and nodemailer (10.0.15 -> 10.6.1).
 *  - The installed versions are at least the patched ones; zod stays 3.x on purpose (zod 4 is a breaking major).
 *  - The exposure assumptions of the report stay true: no Server Actions, no edge-runtime routes, no SVG uploads, the
 *    image optimizer never allows SVG, Next uses the top-level sharp >= 0.35.5.
 *  - Mail addresses with quotes, semicolons or comments in a display name are built into ONE recipient, and our own
 *    validators never let such strings reach a To/Reply-To header (no SMTP: in-memory stream transport).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import nodemailer from "nodemailer";
import { z } from "zod";
import { buildTransactionalEmail, safeReplyTo } from "../lib/email-templates";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const installed = (name: string) => (JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8")) as { version: string }).version;
const parts = (version: string) => version.split("-")[0].split(".").map(Number);
const atLeast = (version: string, minimum: string) => {
  const [a, b] = [parts(version), parts(minimum)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};
function sourceFiles(dir: string, out: string[] = []) {
  for (const name of readdirSync(join(root, dir))) {
    const path = `${dir}/${name}`;
    if (statSync(join(root, path)).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

test("next and nodemailer are at (or above) the patched versions; same major lines", () => {
  const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  assert.match(pkg.dependencies.next, /^\^15\./);
  assert.match(pkg.devDependencies["eslint-config-next"], /^\^15\./);
  assert.match(pkg.dependencies.nodemailer, /^\^10\./);
  // GHSA-2464-fhr4-w9xw, -p3m5-59mp-jv5r, -7qx7-33qx-rqx2, -f3mh-rxg3-f5g2, -pc58-hwjq-p385: next <= 15.5.28.
  assert.ok(atLeast(installed("next"), "15.5.29"), `next ${installed("next")}`);
  assert.equal(parts(installed("next"))[0], 15);
  assert.ok(atLeast(installed("eslint-config-next"), "15.5.29"));
  // GHSA-8c8m-p3m8-cjg8, -m943-m63m-w62w, -85x2-q946-cp5h: nodemailer 3.0.0 - 10.1.3.
  assert.ok(atLeast(installed("nodemailer"), "10.1.4"), `nodemailer ${installed("nodemailer")}`);
  assert.equal(parts(installed("nodemailer"))[0], 10);
});

test("zod is intentionally still 3.x; sharp (used by the image optimizer) is >= 0.35.5", () => {
  assert.match(JSON.parse(read("package.json")).dependencies.zod, /^\^3\./);
  assert.equal(parts(installed("zod"))[0], 3);
  assert.ok(atLeast(installed("sharp"), "0.35.5"), `sharp ${installed("sharp")}`);
  // Next has no nested copy of sharp: it loads the top-level one above.
  assert.throws(() => statSync(join(root, "node_modules/next/node_modules/sharp")));
});

test("exposure assumptions: no Server Actions, no edge-runtime routes, image optimizer never allows SVG or remote hosts", () => {
  const files = [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib"), "middleware.ts"];
  assert.deepEqual(files.filter((file) => /^﻿?\s*["']use server["']/m.test(read(file)) || /["']use server["']/.test(read(file))), [], "no Server Actions");
  assert.deepEqual(files.filter((file) => /export const runtime\s*=\s*["']edge["']/.test(read(file))), [], "no edge-runtime routes");
  const config = read("next.config.ts");
  assert.doesNotMatch(config, /dangerouslyAllowSVG|remotePatterns|domains\s*:/, "default image config: no SVG, no remote hosts");
});

test("exposure assumptions: uploads accept only JPEG, PNG and WebP (checked by bytes and re-encoded), never SVG", () => {
  for (const route of ["app/api/vendor/[storeId]/assets/route.ts", "app/api/admin/stores/[storeId]/assets/route.ts", "app/api/admin/homepage/assets/route.ts"]) {
    const text = read(route);
    assert.match(text, /\["image\/jpeg", "image\/png", "image\/webp"\]\.includes\(file\.type\)/, route);
    assert.match(text, /validateAndNormalizeStoreImage\(/, route);
    assert.doesNotMatch(text, /svg/i, route);
  }
  assert.doesNotMatch(read("lib/storage/store-assets.ts").match(/export function detectImageType[\s\S]*?\n}\n/)![0], /svg/i);
});

test("mail: a display name with quotes, a semicolon and a comment stays ONE recipient; our validators reject such input", async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const addressparser = require("nodemailer/lib/addressparser") as (input: string) => { name?: string; address?: string; group?: unknown[] }[];
  const tricky = "\"Evil; \\\"Name\\\" (x)\" (comment; more) <buyer@example.invalid>";
  const parsed = addressparser(tricky);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].address, "buyer@example.invalid");
  // Compose a real message (no network): the To header carries exactly that one address.
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const message = buildTransactionalEmail("ORDER_STATUS", { orderRef: "o1", storeName: "Test \"mağaza\"; (x)", status: "PREPARING" }, "\"BAGATI; \\\"Sistem\\\"\" <noreply@example.invalid>", tricky, "<m1@example.invalid>");
  const info = await transport.sendMail(message) as unknown as { envelope: { from: string; to: string[] }; message: Buffer };
  assert.deepEqual(info.envelope.to, ["buyer@example.invalid"]);
  assert.equal(info.envelope.from, "noreply@example.invalid");
  const toHeader = info.message.toString("utf8").match(/^To: (.*)$/m)![1];
  assert.equal((toHeader.match(/@/g) ?? []).length, 1, toHeader);
  // Our inputs: zod .email() (all recipient fields) and safeReplyTo (Reply-To) refuse display names, quotes and ';'.
  for (const value of [tricky, "a;b@example.invalid", "\"x\"@example.invalid", "a@example.invalid, b@example.invalid", "x (c) <a@example.invalid>"]) {
    assert.equal(z.string().trim().email().safeParse(value).success, false, value);
    assert.equal(safeReplyTo(value), undefined, value);
  }
  assert.equal(safeReplyTo("buyer@example.invalid"), "buyer@example.invalid");
});
