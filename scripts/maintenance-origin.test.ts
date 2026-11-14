import assert from "node:assert/strict";
import test from "node:test";
import { maintenanceStateOrigin, parseInternalOrigin, resetInternalOriginWarning } from "../lib/maintenance-origin";

test("BAGATI_INTERNAL_ORIGIN: loopback and private hosts over http(s), no path", () => {
  for (const [raw, origin] of [
    ["http://127.0.0.1:3000", "http://127.0.0.1:3000"], ["http://127.0.0.1:3000/", "http://127.0.0.1:3000"], [" http://localhost:3000 ", "http://localhost:3000"],
    ["http://10.0.0.5:3000", "http://10.0.0.5:3000"], ["http://172.16.0.2", "http://172.16.0.2"], ["http://172.31.255.1:8080", "http://172.31.255.1:8080"],
    ["http://192.168.1.10:3000", "http://192.168.1.10:3000"], ["https://127.0.0.1:3443", "https://127.0.0.1:3443"], ["http://[::1]:3000", "http://[::1]:3000"], ["http://[fd12:3456::1]:3000", "http://[fd12:3456::1]:3000"],
  ]) assert.deepEqual(parseInternalOrigin(raw), { origin }, raw);
  assert.equal(parseInternalOrigin(undefined), null);
  assert.equal(parseInternalOrigin(""), null);
  assert.equal(parseInternalOrigin("   "), null);
});

test("BAGATI_INTERNAL_ORIGIN: public hosts, other schemes, paths, queries and credentials are ignored", () => {
  for (const raw of [
    "https://shopbagati.com", "http://8.8.8.8:3000", "http://172.32.0.1", "http://172.15.0.1", "http://192.169.0.1", "http://11.0.0.1",
    "http://127.0.0.1.nip.io:3000", "http://internal:3000", "http://[2001:db8::1]:3000",
    "ftp://127.0.0.1", "file:///etc/passwd", "javascript:alert(1)", "127.0.0.1:3000", "not a url",
    "http://127.0.0.1:3000/api", "http://127.0.0.1:3000/?x=1", "http://127.0.0.1:3000/#a", "http://127.0.0.1:3000?", "http://user:pw@127.0.0.1:3000",
  ]) assert.ok(parseInternalOrigin(raw) && "ignored" in parseInternalOrigin(raw)!, raw);
});

test("origin choice: internal when valid; the request origin otherwise, with one warning per invalid value", () => {
  resetInternalOriginWarning();
  const warnings: string[] = [];
  const warn = (message: string) => { warnings.push(message); };
  assert.deepEqual(maintenanceStateOrigin("https://localhost:3000", "http://127.0.0.1:3000", warn), { origin: "http://127.0.0.1:3000", source: "internal" });
  assert.deepEqual(maintenanceStateOrigin("http://localhost:3000", undefined, warn), { origin: "http://localhost:3000", source: "request" });
  assert.equal(warnings.length, 0, "not set: no warning");
  for (let i = 0; i < 3; i += 1) assert.deepEqual(maintenanceStateOrigin("http://localhost:3000", "https://shopbagati.com", warn), { origin: "http://localhost:3000", source: "request" });
  assert.equal(warnings.length, 1, "warned once, not per request");
  assert.match(warnings[0], /BAGATI_INTERNAL_ORIGIN ignored \(host must be localhost, a loopback or a private IP\)/);
  assert.doesNotMatch(warnings[0], /shopbagati/, "the value itself is not logged");
});
