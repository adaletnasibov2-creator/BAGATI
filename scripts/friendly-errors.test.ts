/**
 * Friendly error pages (SCALE-FIX-1 A4): customer, app and global error boundaries show an Azerbaijani page with
 * "Yenidən cəhd et" and a link home instead of Next's bare "Application error", reveal nothing but the digest, and the
 * server writes one structured log line per error (digest + Prisma code, never the message or query string).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { requestErrorLogLine } from "../lib/request-error-log";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const boundaries = ["app/(customer)/error.tsx", "app/error.tsx", "app/global-error.tsx"];
const panel = read("components/error-recovery.tsx");

test("the three error boundaries are client components that render the shared friendly panel", () => {
  for (const path of boundaries) {
    const source = read(path);
    assert.match(source, /^"use client";/, path);
    assert.match(source, /<ErrorRecovery digest=\{error\.digest\} reset=\{reset\}/, path);
    assert.doesNotMatch(source, /error\.message|error\.stack|JSON\.stringify\(error/, `${path} leaks no internals`);
  }
  assert.match(read("app/global-error.tsx"), /<html lang="az">\s*<body>\s*<ErrorRecovery digest=\{error\.digest\} reset=\{reset\} \/>\s*<\/body>\s*<\/html>/);
});

test("the panel: Azerbaijani text, retry button, link home, digest only, 44 px targets", () => {
  assert.match(panel, /Səhifə yüklənmədi/);
  assert.match(panel, /Sayt hazırda çox yüklüdür və ya müvəqqəti xəta baş verdi\./);
  assert.match(panel, /"Yenidən cəhd et"/);
  assert.match(panel, /href="\/"[^>]*>Ana səhifəyə qayıt</);
  assert.match(panel, /Xəta kodu: <span className="font-mono">\{digest\}<\/span>/);
  assert.match(panel, /router\.refresh\(\);\s*reset\(\);/, "retry fetches the page again, then re-renders the segment");
  // DESIGN-T9: both are the shared button (default size md = min-h-12, at least 44 px) instead of hand-written classes.
  assert.match(panel, /<Button onClick=\{retry\} loading=\{retrying\} loadingLabel="Yüklənir…">\{"Yenidən cəhd et"\}<\/Button>/, "retry button");
  assert.match(panel, /<ButtonLink href="\/" variant="secondary">Ana səhifəyə qayıt<\/ButtonLink>/, "the home link");
  assert.match(read("components/ui/button.tsx"), /md: "min-h-12 px-5 text-body"/, "default button size is 48 px");
  assert.match(panel, /role="alert"/);
  assert.doesNotMatch(panel, /\.message|\.stack/);
});

test("the server log line keeps the digest and the Prisma code, never the message or the query string", () => {
  const error = Object.assign(new Error('Invalid `prisma.product.findMany()` invocation: SELECT "secret" FROM ...'), { code: "P2028", digest: "825294488" });
  const line = requestErrorLogLine(error, { path: "/products?q=şəxsi+axtarış&city=baki", method: "GET" }, { routerKind: "App Router", routePath: "/(customer)/products/(list)", routeType: "render", renderSource: "react-server-components" });
  assert.deepEqual(JSON.parse(line), {
    event: "request_error", digest: "825294488", code: "P2028", name: "Error", method: "GET", path: "/products",
    routePath: "/(customer)/products/(list)", routeType: "render", renderSource: "react-server-components",
  });
  assert.doesNotMatch(line, /secret|SELECT|axtarış|city=/);
});

test("the log line survives odd error values", () => {
  assert.equal(JSON.parse(requestErrorLogLine("boom", { path: "/", method: "GET" }, {})).name, "string");
  assert.equal(JSON.parse(requestErrorLogLine(null, { path: "/", method: "GET" }, {})).digest, undefined);
  assert.equal(JSON.parse(requestErrorLogLine({ code: 42, digest: "x".repeat(500) }, { path: "/", method: "GET" }, {})).code, undefined);
});

test("instrumentation exports onRequestError and only logs", () => {
  const source = read("instrumentation.ts");
  assert.match(source, /export async function onRequestError\(/);
  assert.match(source, /console\.error\(requestErrorLogLine\(error, request, context\)\)/);
  assert.match(source, /export async function register\(\)/, "the email worker start hook is unchanged");
});
