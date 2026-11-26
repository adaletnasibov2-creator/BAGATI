/**
 * STORE-HOURS: optional store opening hours, shown as an information-only dot (pure tests, no database).
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  bakuMinutesOfDay, isWithinStoreHours, normalizeStoreHoursInput, parseStoreTime, STORE_HOURS_TEXTS, STORE_HOURS_TIME_ZONE,
  storeHoursLine, storeHoursOf,
} from "../lib/store-hours";
import { StoreHoursDot } from "../components/store-hours-dot";
import { joinStoreTime, splitStoreTime, STORE_HOUR_OPTIONS, STORE_MINUTE_STEP_OPTIONS, storeMinuteOptions } from "../lib/store-time-select";

(globalThis as { React?: typeof React }).React = React;
const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
/** A Baku wall-clock time on 2026-11-22 as an instant (Baku is UTC+4 all year; used only to BUILD test inputs). */
const baku = (hhmm: string, day = 22) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, day, h - 4, m));
};

// ---------------------------------------------------------------------------------------------------------------
// Parse, validate, format

test("parse: only HH:MM from 00:00 to 23:59", () => {
  assert.equal(parseStoreTime("00:00"), 0);
  assert.equal(parseStoreTime("09:30"), 570);
  assert.equal(parseStoreTime("23:59"), 1439);
  for (const bad of ["24:00", "9:00", "09:60", "09:00:00", " 09:00", "09.00", "", "ab:cd", null, undefined]) assert.equal(parseStoreTime(bad as string), null, String(bad));
});

test("input: both empty = cleared; one field only, wrong format and equal times are refused", () => {
  assert.deepEqual(normalizeStoreHoursInput({ openingTime: "", closingTime: "" }), { ok: true, value: { openingTime: null, closingTime: null } });
  assert.deepEqual(normalizeStoreHoursInput({ openingTime: null, closingTime: undefined }), { ok: true, value: { openingTime: null, closingTime: null } });
  assert.deepEqual(normalizeStoreHoursInput({ openingTime: " 09:00 ", closingTime: "18:00" }), { ok: true, value: { openingTime: "09:00", closingTime: "18:00" } });
  assert.deepEqual(normalizeStoreHoursInput({ openingTime: "18:00", closingTime: "02:00" }), { ok: true, value: { openingTime: "18:00", closingTime: "02:00" } }, "overnight is valid");
  assert.deepEqual(normalizeStoreHoursInput({ openingTime: "09:00", closingTime: "" }), { ok: false, reason: "ONE_FIELD_ONLY" });
  assert.deepEqual(normalizeStoreHoursInput({ openingTime: "", closingTime: "18:00" }), { ok: false, reason: "ONE_FIELD_ONLY" });
  assert.deepEqual(normalizeStoreHoursInput({ openingTime: "09:00", closingTime: "09:00" }), { ok: false, reason: "EQUAL_TIMES" });
  assert.deepEqual(normalizeStoreHoursInput({ openingTime: "9:00", closingTime: "18:00" }), { ok: false, reason: "FORMAT" });
  assert.deepEqual(normalizeStoreHoursInput({ openingTime: "09:00", closingTime: "24:00" }), { ok: false, reason: "FORMAT" });
  assert.deepEqual(normalizeStoreHoursInput({ openingTime: 900, closingTime: "18:00" }), { ok: false, reason: "FORMAT" });
});

test("line: approved text with an en dash; nothing without valid hours", () => {
  assert.equal(storeHoursLine({ openingTime: "09:00", closingTime: "18:00" }), "İş saatları: 09:00–18:00");
  assert.equal(storeHoursLine({ openingTime: "18:00", closingTime: "02:00" }), "İş saatları: 18:00–02:00");
  for (const store of [{}, { openingTime: null, closingTime: null }, { openingTime: "09:00", closingTime: null }, { openingTime: "09:00", closingTime: "09:00" }, { openingTime: "x", closingTime: "18:00" }]) {
    assert.equal(storeHoursLine(store), null);
    assert.equal(storeHoursOf(store), null);
  }
});

test("approved texts are exact; no 'Açıq' / 'Bağlı' and no delivery or answer promise", () => {
  assert.deepEqual(STORE_HOURS_TEXTS, {
    sectionTitle: "İş saatları",
    openingLabel: "Açılış saatı",
    closingLabel: "Bağlanış saatı",
    help: "Bu, mağazanın iş saatlarıdır. Sifarişlər istənilən vaxt qəbul olunur.",
    inside: "İndi iş saatıdır",
    outside: "İndi iş saatı deyil",
    // STORE-HOURS-2: owner-approved error text for refused hours only.
    error: "Açılış və bağlanış saatını birlikdə yazın; saatlar eyni ola bilməz.",
  });
  for (const file of ["lib/store-hours.ts", "components/store-hours-dot.tsx"]) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(code, /Açıq|Bağlı\b|çatdırıl|cavab/i, file);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Within hours (Baku time, injected "now")

test("Baku clock: Intl with Asia/Baku, no fixed offset math", () => {
  assert.equal(STORE_HOURS_TIME_ZONE, "Asia/Baku");
  assert.equal(bakuMinutesOfDay(new Date("2026-11-22T05:00:00Z")), 9 * 60);
  assert.equal(bakuMinutesOfDay(new Date("2026-11-22T20:30:00Z")), 30, "00:30 the next day in Baku");
  assert.equal(bakuMinutesOfDay(new Date("2026-06-01T19:59:00Z")), 23 * 60 + 59, "summer: Baku has no DST");
  const code = read("lib/store-hours.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.match(code, /timeZone: STORE_HOURS_TIME_ZONE/);
  assert.doesNotMatch(code, /getTimezoneOffset|\+\s*4\s*\*\s*60|4\s*\*\s*60\s*\*\s*60/);
});

test("normal range 09:00–18:00: open inclusive, close exclusive", () => {
  const within = (t: string) => isWithinStoreHours("09:00", "18:00", baku(t));
  assert.equal(within("08:59"), false);
  assert.equal(within("09:00"), true);
  assert.equal(within("12:30"), true);
  assert.equal(within("17:59"), true);
  assert.equal(within("18:00"), false);
  assert.equal(within("23:59"), false);
  assert.equal(within("00:00"), false);
});

test("overnight range 18:00–02:00 works across midnight", () => {
  const within = (t: string, day?: number) => isWithinStoreHours("18:00", "02:00", baku(t, day));
  assert.equal(within("17:59"), false);
  assert.equal(within("18:00"), true);
  assert.equal(within("23:59"), true);
  assert.equal(within("00:00", 23), true);
  assert.equal(within("01:59", 23), true);
  assert.equal(within("02:00", 23), false);
  assert.equal(within("12:00"), false);
});

test("edge ranges: 00:00–23:59 and 23:59–00:00; invalid pairs give null", () => {
  assert.equal(isWithinStoreHours("00:00", "23:59", baku("00:00")), true);
  assert.equal(isWithinStoreHours("00:00", "23:59", baku("23:59")), false, "close is exclusive");
  assert.equal(isWithinStoreHours("23:59", "00:00", baku("23:59")), true);
  assert.equal(isWithinStoreHours("23:59", "00:00", baku("00:00")), false);
  assert.equal(isWithinStoreHours("09:00", "09:00", baku("09:00")), null, "equal times are invalid");
  assert.equal(isWithinStoreHours("09:00", null, baku("10:00")), null, "one field only is invalid");
  assert.equal(isWithinStoreHours(null, null, baku("10:00")), null);
});

// ---------------------------------------------------------------------------------------------------------------
// Dot component

test("dot: server render is an empty box of fixed size (no colour, no text); decided after mount, every 60 s, paused when hidden", () => {
  const html = renderToStaticMarkup(createElement(StoreHoursDot, { openingTime: "09:00", closingTime: "18:00" }));
  assert.match(html, /data-store-hours-dot="pending"/);
  assert.match(html, /h-2\.5 w-2\.5/);
  assert.doesNotMatch(html, /İndi|title=|bg-emerald|border-line-strong/);
  const code = read("components/store-hours-dot.tsx");
  assert.match(code, /^"use client";/);
  assert.match(code, /useState<boolean \| null>\(null\)/);
  assert.match(code, /setInterval\(check, 60_000\)/);
  assert.match(code, /visibilitychange/);
  assert.match(code, /className="sr-only">\{text\}/);
  assert.match(code, /title=\{text \?\? undefined\}/);
  assert.match(code, /inside \? STORE_HOURS_TEXTS\.inside : STORE_HOURS_TEXTS\.outside/);
});

test("dot colours are real design tokens (green filled dot, grey hollow ring): no class that Tailwind would drop", () => {
  const code = read("components/store-hours-dot.tsx");
  assert.match(code, /inside \? "h-2\.5 w-2\.5 rounded-full bg-emerald" : "h-2\.5 w-2\.5 rounded-full border-2 border-line-strong bg-white"/);
  // `emerald` is ONE token in this project (no shades), so e.g. bg-emerald-600 would produce no CSS at all.
  assert.doesNotMatch(code, /emerald-\d|green-\d/);
  const tailwind = read("tailwind.config.ts");
  assert.match(tailwind, /emerald: "var\(--bagati-accent\)",/);
  assert.match(tailwind, /line: \{ DEFAULT: "var\(--bagati-border\)", strong: "var\(--bagati-border-strong\)" \},/);
});

// ---------------------------------------------------------------------------------------------------------------
// Where it shows, and the queries feeding it

test("public: store page line (server text) + dot next to the name; dot on /stores and home store cards; nothing without hours", () => {
  const header = read("components/storefront-branding.tsx");
  assert.match(header, /\{store\.hours && <StoreHoursDot openingTime=\{store\.hours\.openingTime\} closingTime=\{store\.hours\.closingTime\}\/>\}/);
  assert.match(header, /<h1 className="min-w-0 break-words font-display text-h1 text-fg">\{store\.name\}<\/h1>/, "the dot is outside the h1");
  assert.match(header, /\{store\.hours && <>[\s\S]*?data-store-hours-line=""[\s\S]*?\{storeHoursLine\(store\.hours\)\}/);
  assert.match(read("app/(customer)/stores/[storeId]/page.tsx"), /hours: storeHoursOf\(store\),/);
  assert.match(read("components/store-card.tsx"), /\{hours && <StoreHoursDot openingTime=\{hours\.openingTime\} closingTime=\{hours\.closingTime\}\/>\}/);
  assert.match(read("components/home/store-strip.tsx"), /\{hours && <StoreHoursDot openingTime=\{hours\.openingTime\} closingTime=\{hours\.closingTime\} className="mt-\[5px\]"\/>\}/);
  assert.match(read("app/(customer)/stores/page.tsx"), /openingTime=\{store\.openingTime\} closingTime=\{store\.closingTime\}/);
  // Product page store block and the map are unchanged (no dot there).
  for (const file of ["app/(customer)/products/[productId]/page.tsx", "components/interactive-map-surface.tsx"]) assert.doesNotMatch(read(file), /store-hours|StoreHoursDot/, file);
});

test("queries: the two columns ride in the existing selects (no extra query)", () => {
  assert.match(read("lib/public-store-discovery.ts"), /openingTime: true,\s+closingTime: true,\s+city: \{ select: \{ name: true, slug: true \} \},/);
  const home = read("lib/home-page-data.ts");
  assert.equal(home.match(/openingTime: true/g)?.length, 2, "both home store selects");
  assert.match(read("app/(customer)/stores/[storeId]/page.tsx"), /openingTime: true,\s+closingTime: true,/);
});

test("not in sitemap or JSON-LD (no openingHours yet)", () => {
  for (const file of ["lib/sitemap.ts", "lib/structured-data.ts", "app/sitemap.ts"]) assert.doesNotMatch(read(file), /openingTime|openingHours|store-hours/, file);
});

// ---------------------------------------------------------------------------------------------------------------
// Seller API and form

test("seller API: both fields validated on the server as a pair, saved together, audited, generic error", () => {
  const route = read("app/api/vendor/[storeId]/[section]/route.ts");
  // Read straight from the body, not through the zod object `d`, so the raw values can never reach `...values`.
  assert.match(route, /const hoursSent=b\?\.openingTime!==undefined\|\|b\?\.closingTime!==undefined;/);
  assert.match(route, /const hours=hoursSent\?normalizeStoreHoursInput\(\{openingTime:b\?\.openingTime,closingTime:b\?\.closingTime\}\):null;/);
  // STORE-HOURS-2: refused hours get the approved hours text (was the generic message); status 422 and field unchanged.
  assert.match(route, /if\(hours&&!hours\.ok\)return NextResponse\.json\(\{error:STORE_HOURS_TEXTS\.error,field:"storeHours"\},\{status:422\}\);/);
  // Every other profile validation error keeps the existing generic message.
  assert.match(route, /if\(!s\.success\)return NextResponse\.json\(\{error:contactPhoneIssue\(s\.error\)\?\?"Mağaza və hüquqi məlumatları yoxlayın"\},\{status:422\}\);/);
  assert.equal(route.match(/STORE_HOURS_TEXTS\.error/g)?.length, 1, "the hours text is used only for refused hours");
  // The seller form shows the API's error text as is (role="alert"), so no form change is needed for the new text.
  assert.match(read("components/vendor-store-profile-editor.tsx"), /if\(!response\.ok\)throw new Error\(data\.error\|\|"Sorğu yerinə yetirilmədi\."\);/);
  const lf = route.replace(/\r\n/g, "\n");
  const schemaStart = lf.indexOf('if(section==="profile"){\n   const s=z.object({');
  const schemaEnd = lf.indexOf("}).safeParse(b);\n   if(!s.success)return NextResponse.json({error:contactPhoneIssue");
  assert.ok(schemaStart > 0 && schemaEnd > schemaStart, "profile schema found");
  const profileSchema = lf.slice(schemaStart, schemaEnd);
  assert.doesNotMatch(profileSchema, /openingTime|closingTime/, "not in the zod object, so never spread raw into the update");
  assert.match(route, /\.\.\.\(hoursPatch\?\{openingTime:hoursPatch\.openingTime,closingTime:hoursPatch\.closingTime\}:\{\}\),/);
  assert.match(route, /\?\["businessHours"\]:\[\]\),/, "change recorded in the SELLER_STOREFRONT_UPDATE audit");
  assert.match(route, /legalInfoApproved:true,reviewNote:true,openingTime:true,closingTime:true,/, "GET returns them to the form");
});

test("seller form: approved section, labels and help; 24-hour selects; required once any part is chosen; seller design system", () => {
  const form = read("components/vendor-store-profile-editor.tsx");
  assert.match(form, /sectionHead\(STORE_HOURS_TEXTS\.sectionTitle\)\}<p id="store-hours-help" className=\{`mt-1 \$\{vendorHint\}`\}>\{STORE_HOURS_TEXTS\.help\}<\/p>/);
  // STORE-HOURS-3: the browser time inputs (12-hour AM/PM on many PCs) are replaced by hour + minute selects.
  assert.doesNotMatch(form, /type="time"/);
  assert.match(form, /\{timeField\("openingTime",STORE_HOURS_TEXTS\.openingLabel,openingParts,setOpeningParts,openingTime,openingMinutes\)\}\{timeField\("closingTime",STORE_HOURS_TEXTS\.closingLabel,closingParts,setClosingParts,closingTime,closingMinutes\)\}/);
  const field = form.slice(form.indexOf("const timeField="), form.indexOf("const sectionHead="));
  // The visible label stays the approved label; the only new visible text is the "—" (not set) option.
  assert.match(field, /<div role="group" aria-labelledby=\{`\$\{name\}-label`\} className=\{vendorLabel\}><span id=\{`\$\{name\}-label`\}>\{label\}<\/span>/);
  assert.equal(field.match(/<option value="">—<\/option>/g)?.length, 2, "hour and minute each start with the empty option");
  assert.match(field, /<select aria-label=\{label\} value=\{parts\.hour\}.*?required=\{hoursTouched\} aria-describedby="store-hours-help" className=\{`\$\{input\} cursor-pointer`\}>/);
  assert.match(field, /<select aria-label=\{`\$\{label\}, dəqiqə`\} value=\{parts\.minute\}.*?required=\{hoursTouched\} aria-describedby="store-hours-help" className=\{`\$\{input\} cursor-pointer`\}>/);
  assert.match(field, /\{STORE_HOUR_OPTIONS\.map\(hour=>/);
  assert.match(field, /\{minutes\.map\(minute=>/);
  // The only named field is the hidden "HH:MM" (or "") value, so the request body keeps the same two keys.
  assert.match(field, /<input type="hidden" name=\{name\} value=\{value\}\/>/);
  assert.doesNotMatch(field, /<select name=/);
  assert.match(form, /const openingTime=joinStoreTime\(openingParts\.hour,openingParts\.minute\); const closingTime=joinStoreTime\(closingParts\.hour,closingParts\.minute\);/);
  assert.match(form, /const openingMinutes=storeMinuteOptions\(store\.openingTime\); const closingMinutes=storeMinuteOptions\(store\.closingTime\);/);
  assert.match(form, /const hoursTouched=Boolean\(openingParts\.hour\|\|openingParts\.minute\|\|closingParts\.hour\|\|closingParts\.minute\);/);
  assert.doesNotMatch(field, /emerald/);
  assert.doesNotMatch(form, /PublicTheme/);
});

// ---------------------------------------------------------------------------------------------------------------
// STORE-HOURS-3: 24-hour picker helpers

test("picker: split a saved HH:MM into hour and minute; anything else is not set", () => {
  assert.deepEqual(splitStoreTime("09:00"), { hour: "09", minute: "00" });
  assert.deepEqual(splitStoreTime("23:55"), { hour: "23", minute: "55" });
  assert.deepEqual(splitStoreTime("00:00"), { hour: "00", minute: "00" });
  assert.deepEqual(splitStoreTime("09:07"), { hour: "09", minute: "07" }, "odd minute kept");
  for (const value of ["", null, undefined, "9:00", "24:00", "12:60", "09:00:00", "x"]) {
    assert.deepEqual(splitStoreTime(value), { hour: "", minute: "" }, String(value));
  }
});

test("picker: join gives HH:MM only when both parts are chosen; never a half value", () => {
  assert.equal(joinStoreTime("09", "00"), "09:00");
  assert.equal(joinStoreTime("18", "30"), "18:30");
  assert.equal(joinStoreTime("09", "07"), "09:07");
  assert.equal(joinStoreTime("", ""), "");
  assert.equal(joinStoreTime("09", ""), "", "hour only");
  assert.equal(joinStoreTime("", "30"), "", "minute only");
  assert.equal(joinStoreTime("24", "00"), "");
  assert.equal(joinStoreTime("9", "00"), "");
  assert.equal(joinStoreTime("12", "60"), "");
  for (const value of ["00:00", "09:07", "18:00", "23:55"]) {
    const { hour, minute } = splitStoreTime(value);
    assert.equal(joinStoreTime(hour, minute), value, `round trip ${value}`);
    assert.deepEqual(normalizeStoreHoursInput({ openingTime: joinStoreTime(hour, minute), closingTime: "02:00" }).ok, value !== "02:00");
  }
});

test("picker: 24 hours and 5-minute steps; a saved odd minute is added for that field only", () => {
  assert.equal(STORE_HOUR_OPTIONS.length, 24);
  assert.equal(STORE_HOUR_OPTIONS[0], "00");
  assert.equal(STORE_HOUR_OPTIONS[23], "23");
  assert.deepEqual(STORE_MINUTE_STEP_OPTIONS, ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"]);
  assert.deepEqual(storeMinuteOptions(null), STORE_MINUTE_STEP_OPTIONS);
  assert.deepEqual(storeMinuteOptions("09:30"), STORE_MINUTE_STEP_OPTIONS);
  assert.deepEqual(storeMinuteOptions("bad"), STORE_MINUTE_STEP_OPTIONS);
  assert.deepEqual(storeMinuteOptions("09:07"), ["00", "05", "07", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"]);
  assert.equal(STORE_MINUTE_STEP_OPTIONS.length, 12, "the shared list is not changed by an odd minute");
});

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(relative(root, full).replace(/\\/g, "/"));
  }
  return out;
}

test("guard: order, cart, checkout, payment and email code never import or read store hours", () => {
  const files = [
    ...walk(join(root, "app/api/orders")), ...walk(join(root, "app/api/cart")), ...walk(join(root, "app/api/payments")),
    ...walk(join(root, "app/(customer)/cart")), ...walk(join(root, "app/(customer)/checkout")), ...walk(join(root, "app/(customer)/orders")),
    ...walk(join(root, "lib/payments")),
    ...readdirSync(join(root, "lib")).filter((name) => /^(order-|email|seller-order-emails|cart-|delivery|epoint)/.test(name) && /\.tsx?$/.test(name)).map((name) => `lib/${name}`),
    ...readdirSync(join(root, "components")).filter((name) => /^(cart|checkout|order|add-to-cart|quick-add-to-cart|vendor-order)/.test(name)).map((name) => `components/${name}`),
  ];
  assert.ok(files.length > 40, `scanned ${files.length} files`);
  for (const file of files) assert.doesNotMatch(read(file), /store-hours|openingTime|closingTime|StoreHoursDot/, file);
});

test("seller panel never renders PublicTheme; the dot is public only", () => {
  for (const file of walk(join(root, "app/vendor"))) assert.doesNotMatch(read(file), /PublicTheme/, file);
  for (const file of walk(join(root, "app/vendor"))) assert.doesNotMatch(read(file), /StoreHoursDot/, file);
});

// ---------------------------------------------------------------------------------------------------------------
// Migration

const MIGRATION = "prisma/migrations/20261122000000_store_business_hours/migration.sql";

test("migration: additive, one ALTER TABLE, nullable VARCHAR(5), CHECKs for format, pair and not-equal; LF; sorts after the previous migration", () => {
  const raw = readFileSync(join(root, MIGRATION), "utf8");
  assert.doesNotMatch(raw, /\r/, "LF (Prisma checksum)");
  const sql = raw.replace(/--[^\n]*/g, "");
  assert.equal(sql.match(/ALTER TABLE/g)?.length, 1);
  assert.match(sql, /ADD COLUMN "openingTime" VARCHAR\(5\),/);
  assert.match(sql, /ADD COLUMN "closingTime" VARCHAR\(5\),/);
  assert.doesNotMatch(sql, /DEFAULT|NOT NULL,|DROP|UPDATE |DELETE |TRUNCATE|RENAME/i);
  const timeRegex = "'^([01][0-9]|2[0-3]):[0-5][0-9]$'";
  assert.ok(sql.includes(`CHECK ("openingTime" IS NULL OR "openingTime" ~ ${timeRegex})`));
  assert.ok(sql.includes(`CHECK ("closingTime" IS NULL OR "closingTime" ~ ${timeRegex})`));
  assert.match(sql, /\("openingTime" IS NULL AND "closingTime" IS NULL\)\s+OR \("openingTime" IS NOT NULL AND "closingTime" IS NOT NULL AND "openingTime" <> "closingTime"\)/);
  // The database rule matches the app rule.
  const dbPattern = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
  for (const value of ["00:00", "09:00", "23:59", "24:00", "9:00", "09:60"]) assert.equal(dbPattern.test(value), parseStoreTime(value) !== null, value);
  const folders = readdirSync(join(root, "prisma/migrations")).filter((name) => /^\d{14}_/.test(name)).sort();
  // CLEANUP-2: was "sorts last", which broke when a newer migration (20261125120000_store_order_customer_confirmed)
  // was added. The intent is the order: it exists and runs right after the migration it was written on top of.
  const index = folders.indexOf("20261122000000_store_business_hours");
  assert.ok(index > 0, "the migration exists");
  assert.equal(folders[index - 1], "20261121010000_store_notification_email", "it sorts right after the previous migration");
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /openingTime\s+String\?\s+@db\.VarChar\(5\)/);
  assert.match(schema, /closingTime\s+String\?\s+@db\.VarChar\(5\)/);
});
