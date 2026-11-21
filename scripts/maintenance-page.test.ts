/**
 * MAINTENANCE-PAGE + AUTH-CLEANUP: the designed static 503 page (approved texts only, headers, no database), the
 * explicit bypass list (new payments blocked), fail-open, quick switch-off; the seller login sentence; token clean-up of
 * the forgot / reset / verify-email / Google-link pages with byte-identical texts. fetch is always stubbed.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { isMaintenanceExempt, maintenanceHeaders, maintenanceHtml, maintenanceResponse, MAINTENANCE_FONT_PATH, MAINTENANCE_PAGE_TEXT } from "../lib/maintenance";
import { maintenanceState, MAINTENANCE_STATE_ON_TTL_MS, MAINTENANCE_STATE_TTL_MS, resetMaintenanceStateCache } from "../lib/maintenance-state";
import { resetMaintenancePreviewCache } from "../lib/maintenance-preview";
import { GoogleLinkPanel } from "../components/google-link-form";
import { EmailVerificationForm } from "../components/email-verification-form";
import { ForgotPasswordForm } from "../components/forgot-password-form";
import { ResetPasswordForm } from "../components/reset-password-form";

(globalThis as { React?: typeof React }).React = React;
const h = React.createElement;
const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const visible = (html: string) => html.replace(/<style>[\s\S]*?<\/style>|<title>[\s\S]*?<\/title>/g, "").replace(/<[^>]+>/g, "\n").split("\n").map((t) => t.trim()).filter(Boolean);

// ---------------------------------------------------------------------------------------------------------------
// The page

test("page: exactly the approved texts and the brand name, nothing else visible", () => {
  assert.deepEqual(MAINTENANCE_PAGE_TEXT, {
    title: "Sayt qısa müddətə texniki xidmətdədir",
    body: "Daha yaxşı xidmət üçün yeniləmələr aparırıq. Tezliklə yenidən buradayıq.",
    footnote: "Anlayışınıza görə təşəkkür edirik.",
  });
  const html = maintenanceHtml();
  assert.deepEqual(visible(html), ["BAGATI", MAINTENANCE_PAGE_TEXT.title, MAINTENANCE_PAGE_TEXT.body, MAINTENANCE_PAGE_TEXT.footnote]);
  assert.match(html, /<title>Sayt qısa müddətə texniki xidmətdədir · BAGATI<\/title>/);
  assert.doesNotMatch(visible(html).join(" "), /\d{1,2}:\d{2}|saat|dəqiqə|telefon|e-poçt|@|ödəniş|kart|pulsuz|★/i, "no time estimate, no contact, no payment claims");
});

test("page: one main, one h1, lang=az, noindex,nofollow, no script, no canonical, no Open Graph, same-origin assets only", () => {
  const html = maintenanceHtml();
  assert.match(html, /^<!doctype html>\n<html lang="az">/);
  assert.equal(html.match(/<main\b/g)?.length, 1);
  assert.equal(html.match(/<h1\b/g)?.length, 1);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.doesNotMatch(html, /<script|rel="canonical"|og:|twitter:|\son[a-z]+=/i, "no script, no event handlers, no canonical, no share preview");
  const urls = [...html.matchAll(/(?:src|href)="([^"]+)"|url\(([^)]+)\)/g)].map((m) => m[1] ?? m[2]);
  assert.deepEqual(urls.sort(), ["/bagati-mark.svg", MAINTENANCE_FONT_PATH, MAINTENANCE_FONT_PATH].sort());
  assert.match(html, /<img src="\/bagati-mark\.svg" width="30" height="42" alt="">/, "fixed size: no layout shift");
  assert.match(html, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(html, /font-display:optional/, "the heading font never swaps after the first paint (no shift)");
  assert.match(html, /<link rel="preload" href="\/fonts\/fraunces-variable-az\.woff2" as="font" type="font\/woff2" crossorigin>/);
});

test("page: built without the database (pure module), same bytes every time; the font copy equals the site font", () => {
  const source = read("lib/maintenance.ts");
  assert.doesNotMatch(source, /^import /m, "no imports at all: no Prisma, no settings, no React");
  assert.equal(maintenanceHtml(), maintenanceHtml());
  assert.equal(sha256(readFileSync(join(root, "public", MAINTENANCE_FONT_PATH))), sha256(readFileSync(join(root, "app/fonts/fraunces-variable-az.woff2"))));
  assert.ok(readFileSync(join(root, "public/fonts/Fraunces-OFL.txt"), "utf8").includes("SIL Open Font License"));
  // Font and mark skip the middleware (matcher) and are exempt anyway.
  const matcher = new RegExp(`^${read("middleware.ts").match(/matcher: \["([^"]+)"\]/)![1].replace(/\\\\/g, "\\")}$`);
  for (const path of [MAINTENANCE_FONT_PATH, "/bagati-mark.svg"]) {
    assert.equal(matcher.test(path), false, `${path} skips the middleware`);
    assert.equal(isMaintenanceExempt(path), true, path);
  }
});

test("headers: 503, Retry-After 600, no-store for browsers and Cloudflare, noindex,nofollow; JSON shape for APIs", async () => {
  assert.deepEqual(maintenanceHeaders(), {
    "Retry-After": "600",
    "Cache-Control": "no-store",
    "CDN-Cache-Control": "no-store",
    "Cloudflare-CDN-Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  });
  for (const [path, type] of [["/", /text\/html; charset=utf-8/], ["/api/orders", /application\/json/]] as const) {
    const response = maintenanceResponse(path, "Saytda texniki işlər aparılır. Bir azdan yenidən yoxlayın.");
    assert.equal(response.status, 503, path);
    for (const [name, value] of Object.entries(maintenanceHeaders())) assert.equal(response.headers.get(name), value, `${path} ${name}`);
    assert.match(response.headers.get("content-type") ?? "", type);
  }
  assert.deepEqual(await maintenanceResponse("/api/orders", "Saytda texniki işlər aparılır. Bir azdan yenidən yoxlayın.").json(), { error: "Saytda texniki işlər aparılır. Bir azdan yenidən yoxlayın.", code: "MAINTENANCE" });
  // The checkout shows any API error's `error` text (components/checkout-form.tsx).
  assert.match(read("components/checkout-form.tsx"), /throw new Error\(data\.error\|\|"Sifariş yaradılmadı\."\)/);
});

// ---------------------------------------------------------------------------------------------------------------
// Bypass list and the middleware

test("bypass list is explicit: admin + login, health/readiness, Epoint callback + payment check, logout, ingest, static", () => {
  for (const path of ["/admin", "/admin/login", "/admin/settings", "/api/admin/login", "/api/admin/login/2fa", "/api/admin/settings/maintenance.enabled",
    "/api/health", "/api/ready", "/api/maintenance-state", "/api/maintenance-state/viewer", "/api/auth/logout",
    "/api/payments/epoint/callback", "/api/payments/epoint/reconcile", "/api/security/ingest/cloudflare",
    "/_next/static/chunks/a.js", "/favicon.ico", "/bagati-mark.svg", "/fonts/fraunces-variable-az.woff2", "/robots.txt", "/sitemap.xml", "/uploads/x/y.webp"]) {
    assert.equal(isMaintenanceExempt(path), true, path);
  }
  for (const path of ["/", "/products", "/stores/x", "/cart", "/checkout", "/orders/x", "/account", "/login", "/register", "/vendor", "/vendor/login", "/vendor/apply",
    "/api/orders", "/api/cart/items", "/api/auth/login", "/api/auth/register", "/api/vendor/x/orders", "/api/account/addresses", "/api/stores/x/inquiries",
    "/api/payments/epoint/initiate", "/api/payments/other", "/api/healthx", "/adminx"]) {
    assert.equal(isMaintenanceExempt(path), false, path);
  }
  // /api/health answers {"status":"ok"} without touching the database.
  const health = read("app/api/health/route.ts");
  assert.match(health, /NextResponse\.json\(\{ status: "ok" \}/);
  assert.doesNotMatch(health, /prisma|getSetting/);
});

async function withFetch(fetcher: typeof fetch, run: (middleware: (request: NextRequest) => Promise<Response>) => Promise<void>) {
  const { middleware } = await import("../middleware");
  resetMaintenanceStateCache(); resetMaintenancePreviewCache();
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { await run(middleware as (request: NextRequest) => Promise<Response>); }
  finally { globalThis.fetch = realFetch; resetMaintenanceStateCache(); resetMaintenancePreviewCache(); }
}
const request = (path: string, method = "GET") => new NextRequest(`http://localhost:3000${path}`, { method, headers: { host: "localhost:3000", ...(method === "GET" ? {} : { origin: "http://localhost:3000", "content-type": "application/json" }) } });

test("middleware ON: page 503 with the designed page; POST /api/orders and a new payment refused before any route runs", async () => {
  await withFetch((async () => Response.json({ enabled: true, message: "Saytda texniki işlər aparılır. Bir azdan yenidən yoxlayın." })) as typeof fetch, async (middleware) => {
    const home = await middleware(request("/"));
    assert.equal(home.status, 503);
    assert.equal(await home.text(), maintenanceHtml());
    for (const [path, method] of [["/api/orders", "POST"], ["/api/cart/items", "POST"], ["/api/payments/epoint/initiate", "POST"], ["/api/stores/x/inquiries", "POST"], ["/api/products", "GET"]] as const) {
      const response = await middleware(request(path, method));
      assert.equal(response.status, 503, path);
      assert.equal((await response.json()).code, "MAINTENANCE", path);
    }
    for (const [path, method] of [["/api/health", "GET"], ["/admin/login", "GET"], ["/api/admin/login", "POST"], ["/api/payments/epoint/callback", "POST"], ["/api/payments/epoint/reconcile", "POST"]] as const) {
      assert.notEqual((await middleware(request(path, method))).status, 503, path);
    }
  });
});

test("fail-open: a failing or broken state check never closes the site", async () => {
  for (const fetcher of [
    (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch,
    (async () => new Response("db down", { status: 500 })) as typeof fetch,
    (async () => Response.json({ enabled: "yes" })) as typeof fetch,
  ]) {
    await withFetch(fetcher, async (middleware) => {
      for (const path of ["/", "/products", "/api/cart"]) assert.notEqual((await middleware(request(path, path.startsWith("/api") ? "POST" : "GET"))).status, 503, path);
    });
  }
  // The state endpoint reads the settings engine, which falls back to the code defaults (off) on a database error.
  assert.match(read("lib/settings/read.ts"), /cached table \(30 s\) -> on database error the last good table -> code defaults/);
});

test("switching off: an ON answer is kept 1 s, so the normal site is back within about a second; OFF is kept 10 s", async () => {
  assert.equal(MAINTENANCE_STATE_ON_TTL_MS, 1_000);
  assert.equal(MAINTENANCE_STATE_TTL_MS, 10_000);
  resetMaintenanceStateCache();
  let enabled = true;
  const fetcher = (async () => Response.json({ enabled, message: "x" })) as typeof fetch;
  assert.equal((await maintenanceState("http://localhost:3000", fetcher, 50_000)).enabled, true);
  enabled = false; // the admin switches it off (the settings cache of that process is cleared on save)
  assert.equal((await maintenanceState("http://localhost:3000", fetcher, 50_000 + 999)).enabled, true, "still the cached ON answer");
  assert.equal((await maintenanceState("http://localhost:3000", fetcher, 50_000 + 1_000)).enabled, false, "1 s later: open");
  enabled = true;
  assert.equal((await maintenanceState("http://localhost:3000", fetcher, 50_000 + 1_000 + MAINTENANCE_STATE_TTL_MS - 1)).enabled, false, "OFF kept 10 s (cheap while open)");
  resetMaintenanceStateCache();
});

// ---------------------------------------------------------------------------------------------------------------
// Part 3A: seller login sentence

test("3A: the seller login sentence is the approved text; no raw /vendor/apply in the visible text", () => {
  const page = read("app/vendor/login/page.tsx");
  assert.ok(page.includes("Müştəri hesabı satıcı hesabından ayrıdır. Satıcı müraciəti üçün müştəri hesabınızla daxil olun və “Satıcı olmaq istəyirəm” keçidinə basın."));
  assert.doesNotMatch(page, /\/vendor\/apply səhifəsinə/);
  assert.match(read("components/vendor-login-form.tsx"), /<TextLink href="\/vendor\/apply">Satıcı olmaq istəyirəm<\/TextLink>/, "the link the sentence names exists");
});

// ---------------------------------------------------------------------------------------------------------------
// Part 3B: forgot / reset / verify-email / Google-link

const texts = (html: string) => ({
  text: html.replace(/<[^>]+>/g, "\n").split("\n").map((t) => t.trim()).filter(Boolean),
  attrs: [...html.matchAll(/(placeholder|aria-label|title|alt)="([^"]*)"/g)].map((m) => `${m[1]}=${m[2]}`),
});

test("3B: rendered texts are byte-identical to main (captured from main b654051 with the same renderer)", async () => {
  // The Google-link page now uses PublicTheme (next/font), so it cannot render here: its texts are checked in the source
  // below, and the panel (first render before the check) is rendered. Main rendered the page as: "BAGATI", "BAGATI",
  // "Google hesabını təsdiqləyin", then "Yoxlanılır…" or the "unavailable" text and the two links.
  assert.deepEqual(texts(renderToStaticMarkup(h(GoogleLinkPanel))), { text: ["Yoxlanılır…"], attrs: [] });
  assert.deepEqual(texts(renderToStaticMarkup(h(EmailVerificationForm, { role: "CUSTOMER", hasContext: true, deliveryFailed: false, fromLogin: false, nextPath: "/account" }))), {
    text: ["6 rəqəmli təsdiq kodu", "Kod yaradıldığı vaxtdan 10 dəqiqə ərzində qüvvədədir.", "Sorğu qəbul edildi. Əgər yeni hesab yaradılıbsa, təsdiq kodu e-poçt ünvanına göndərilmə növbəsindədir; çatdırılma e-poçt xidmətinin qəbulundan asılıdır.", "Təsdiqlə", "Yeni kod istə", "Giriş səhifəsinə qayıt"], attrs: [],
  });
  assert.deepEqual(texts(renderToStaticMarkup(h(EmailVerificationForm, { role: "CUSTOMER", hasContext: false, deliveryFailed: true, fromLogin: true, nextPath: "/account" }))), {
    text: ["Təsdiq sessiyası mövcud deyil və ya vaxtı bitib. Qeydiyyat və ya giriş səhifəsindən yenidən davam edin.", "Giriş səhifəsinə qayıt"], attrs: [],
  });
  assert.deepEqual(texts(renderToStaticMarkup(h(ForgotPasswordForm))), { text: ["Hesab e-poçtu", "Google ilə yaradılmış hesablar üçün Google ilə daxil olun; bu formada onlar üçün şifrə bərpa məktubu göndərilmir.", "Bərpa keçidi istə"], attrs: [] });
  assert.deepEqual(texts(renderToStaticMarkup(h(ResetPasswordForm, { token: "" }))), { text: ["Bərpa keçidi yoxlanılır…"], attrs: [] });
  // Pages that need next/font (PublicTheme) or cookies: their heading and lead texts, unchanged, in the source.
  for (const [path, strings] of [
    ["app/forgot-password/page.tsx", ["Şifrəni bərpa et", "Hesab e-poçtunuzu yazın. Ünvan aktiv hesabla uyğun gəlsə, bərpa keçidi göndəriləcək.", "Giriş səhifəsinə qayıt"]],
    ["app/reset-password/page.tsx", ["Yeni şifrə təyin et", "Yeni şifrəniz ən azı 12 simvol olmalıdır. Bərpa keçidi 30 dəqiqə sonra qüvvədən düşür.", "Giriş səhifəsinə qayıt"]],
    ["app/(customer)/verify-email/page.tsx", ["BAGATI hesabı", "Email ünvanınızı təsdiqləyin", "Email ünvanınızı təsdiqləmək üçün 6 rəqəmli kod daxil edin. Kod yoxdursa, yenisini istəyin. Təsdiqlənmiş hesab adi girişdə yalnız e-poçt və şifrə ilə açılır."]],
    ["app/auth/google/link/page.tsx", ["BAGATI", "Google hesabını təsdiqləyin", "Google bağlantısı bu serverdə hələ saxlanıla bilmir. E-poçt və şifrə ilə daxil olun.", "Müştəri girişi", "Satıcı girişi"]],
  ] as const) {
    for (const text of strings) assert.ok(read(path).includes(`>${text}<`), `${path}: ${text}`);
  }
  assert.match(read("components/google-link-form.tsx"), /Bu Google e-poçtu mövcud BAGATI hesabına uyğundur\. Hesablar avtomatik birləşdirilmir\. Şifrəni bir dəfə təsdiqləyin, sonra \{portalLabel\} açılacaq\./);
});

test("3B: display-font headings and tokens; no fixed colours except the pinned card frame; Google-link height reserved", () => {
  const frame = "rounded-[28px] border border-[#E6E9EC] border-t-[3px] border-t-[#C49A50] bg-white p-6 shadow-[0_24px_70px_rgba(11,23,38,.09)] sm:p-9";
  for (const path of ["app/forgot-password/page.tsx", "app/reset-password/page.tsx", "app/(customer)/verify-email/page.tsx", "app/auth/google/link/page.tsx"]) {
    const page = read(path);
    assert.match(page, /<h1 className="mt-[28] font-display text-h1 text-fg">/, path);
    assert.ok(page.includes(frame), `${path}: same card frame`);
    assert.deepEqual(page.replace(frame, "").match(/#[0-9A-Fa-f]{3,8}\b/g), null, `${path}: no other fixed colours`);
  }
  for (const path of ["app/(customer)/verify-email/page.tsx", "app/auth/google/link/page.tsx"]) assert.match(read(path), /<p className="text-kicker uppercase text-gold-700">/, path);
  const panel = read("components/google-link-form.tsx");
  assert.doesNotMatch(panel, /#[0-9A-Fa-f]{6}|from "next\/link"/);
  assert.equal(panel.match(/<TextLink href="\/(login|vendor\/login)" className="inline-flex min-h-11 items-center">/g)?.length, 2);
  assert.match(read("app/auth/google/link/page.tsx"), /<div className="min-h-\[19\.5rem\]"><GoogleLinkPanel \/><\/div>/);
  // The Google-link page gets the public fonts and a <main> landmark, like /forgot-password.
  assert.match(read("app/auth/google/link/page.tsx"), /<PublicTheme><main className="container grid min-h-\[68vh\] place-items-center py-10">/);
  assert.match(read("app/reset-password/page.tsx"), /<div className="min-h-\[17rem\]"><ResetPasswordForm token=\{token\} \/><\/div>/, "T9 reservation kept");
  // Unchanged requests and field names.
  assert.match(panel, /fetch\("\/api\/auth\/google\/link", \{ cache: "no-store", signal: controller\.signal \}\)/);
  assert.match(panel, /<Input id="google-link-password" label="BAGATI şifrəsi" type="password"/);
});
