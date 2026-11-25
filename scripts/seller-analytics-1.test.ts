/**
 * SELLER-ANALYTICS-1: seller order analytics. Unit tests only: pure functions, plus the query module with an
 * in-memory stand-in that records every query (no database, no writes).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  analyticsRangeAllowed, ANALYTICS_MAX_RANGE_DAYS, barPercent, categoryTotals, fillBuckets, formatAzn, normalizeCityRows,
  percentChange, previousRange, rangeDays, summarizeReceivedOrders, summarizeStatusGroups, topByValue,
} from "../lib/vendor-sales-analytics";
import { loadVendorSalesAnalytics, UNCATEGORIZED_LABEL, type SalesAnalyticsDb } from "../lib/vendor-sales-analytics-query";
import { dayKey, monthKey, weekKey } from "../lib/vendor-finance";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const BASE = "2da8d23"; // main before SELLER-ANALYTICS-1
const at = (iso: string) => new Date(iso);

// ================================================================= period comparison

test("percentChange: up / down / same, never divides by zero", () => {
  assert.deepEqual(percentChange(12, 10), { kind: "up", percent: 20 });
  assert.deepEqual(percentChange(5, 10), { kind: "down", percent: 50 });
  assert.deepEqual(percentChange(10, 10), { kind: "same", percent: 0 });
  assert.deepEqual(percentChange(1001, 1000), { kind: "same", percent: 0 }, "rounds to whole percent");
  assert.deepEqual(percentChange(3, 0), { kind: "new", percent: null });
  assert.deepEqual(percentChange(0, 0), { kind: "none", percent: null });
  assert.deepEqual(percentChange(0, 4), { kind: "down", percent: 100 });
});

test("previousRange: the same length, ending 1 ms before the current start", () => {
  const start = at("2026-11-01T00:00:00.000Z"), end = at("2026-11-07T23:59:59.999Z");
  const before = previousRange(start, end);
  assert.equal(before.end.getTime(), start.getTime() - 1);
  assert.equal(before.end.getTime() - before.start.getTime(), end.getTime() - start.getTime());
  assert.equal(before.start.toISOString(), "2026-10-25T00:00:00.000Z");
});

test("range bound: 366 days allowed, 367 refused, start after end refused", () => {
  const start = at("2026-01-01T00:00:00.000Z");
  assert.equal(rangeDays(start, at("2026-01-01T23:59:59.999Z")), 1);
  assert.equal(analyticsRangeAllowed(start, new Date(start.getTime() + ANALYTICS_MAX_RANGE_DAYS * 86_400_000 - 1)), true);
  assert.equal(analyticsRangeAllowed(start, new Date(start.getTime() + (ANALYTICS_MAX_RANGE_DAYS + 1) * 86_400_000 - 1)), false);
  assert.equal(analyticsRangeAllowed(at("2026-02-01T00:00:00Z"), at("2026-01-01T00:00:00Z")), false);
});

// ================================================================= grouping

const rows = [
  { status: "NEW", subtotal: "40.00", createdAt: new Date(2026, 9, 3, 10) },
  { status: "CONFIRMED", subtotal: "25.50", createdAt: new Date(2026, 9, 3, 18) },
  { status: "CANCELLED", subtotal: "99.99", createdAt: new Date(2026, 9, 5, 9) },
  { status: "DELIVERED", subtotal: "60.00", createdAt: new Date(2026, 9, 20, 12) },
  { status: "RETURNED", subtotal: "10.00", createdAt: new Date(2026, 10, 2, 12) },
  { status: "PENDING", subtotal: new Prisma.Decimal("4.50"), createdAt: new Date(2026, 10, 2, 13) },
];

test("summarizeReceivedOrders: counts every status; cancelled orders are counted but never in the value", () => {
  const summary = summarizeReceivedOrders(rows);
  assert.equal(summary.received, 6);
  assert.equal(summary.cancelled, 1);
  assert.equal(summary.delivered, 1);
  assert.equal(summary.returned, 1);
  assert.equal(summary.open, 3);
  assert.equal(summary.orderValueCents, 4000 + 2550 + 6000 + 1000 + 450, "99.99 cancelled is excluded");
  assert.equal(summary.averageOrderValueCents, Math.round(14000 / 5));
  assert.equal(summary.cancellationRate, 1 / 6);
  assert.deepEqual(summary.byStatus.map((row) => row.status), ["PENDING", "NEW", "CONFIRMED", "DELIVERED", "CANCELLED", "RETURNED"]);
});

test("summarizeReceivedOrders: buckets use exactly the delivered-sales table's keys (day / Monday-week / month)", () => {
  const summary = summarizeReceivedOrders(rows);
  assert.deepEqual(summary.daily.map((b) => b.key), [dayKey(rows[0].createdAt), dayKey(rows[3].createdAt), dayKey(rows[4].createdAt)]);
  assert.deepEqual(summary.daily[0], { key: dayKey(rows[0].createdAt), orders: 2, valueCents: 6550 }, "two orders the same day; the cancelled one on 5 Oct makes no bucket");
  assert.deepEqual(summary.weekly.map((b) => b.key), [weekKey(rows[0].createdAt), weekKey(rows[3].createdAt), weekKey(rows[4].createdAt)]);
  assert.deepEqual(summary.monthly, [{ key: monthKey(rows[0].createdAt), orders: 3, valueCents: 12550 }, { key: monthKey(rows[4].createdAt), orders: 2, valueCents: 1450 }]);
});

test("empty cases: nothing received -> zeros and nulls (no NaN, no division by zero)", () => {
  const empty = summarizeReceivedOrders([]);
  assert.deepEqual(empty, { received: 0, cancelled: 0, returned: 0, delivered: 0, open: 0, orderValueCents: 0, averageOrderValueCents: null, cancellationRate: null, byStatus: [], daily: [], weekly: [], monthly: [] });
  const onlyCancelled = summarizeReceivedOrders([{ status: "CANCELLED", subtotal: "5", createdAt: new Date() }]);
  assert.equal(onlyCancelled.averageOrderValueCents, null);
  assert.equal(onlyCancelled.cancellationRate, 1);
  assert.deepEqual(onlyCancelled.daily, []);
  assert.deepEqual(summarizeStatusGroups([]), { received: 0, orderValueCents: 0 });
  assert.deepEqual(fillBuckets([], "daily", new Date(2026, 10, 1), new Date(2026, 10, 3)).map((b) => b.orders), [0, 0, 0]);
  assert.equal(barPercent(0, 0), 0);
  assert.equal(barPercent(5, 0), 0);
});

test("summarizeStatusGroups: previous-period totals from groupBy(status); cancelled value excluded", () => {
  assert.deepEqual(summarizeStatusGroups([
    { status: "NEW", orders: 3, subtotal: new Prisma.Decimal("30.00") },
    { status: "CANCELLED", orders: 2, subtotal: "18.00" },
    { status: "DELIVERED", orders: 1, subtotal: null },
  ]), { received: 6, orderValueCents: 3000 });
});

test("fillBuckets: every day / week / month of the range, zeros where nothing was ordered, existing values kept", () => {
  const summary = summarizeReceivedOrders(rows);
  const from = new Date(2026, 9, 1), to = new Date(2026, 10, 3);
  const daily = fillBuckets(summary.daily, "daily", from, to);
  assert.equal(daily.length, 34, "1 Oct .. 3 Nov");
  assert.equal(daily[0].key, dayKey(from));
  assert.equal(daily[daily.length - 1].key, dayKey(to));
  assert.equal(daily.reduce((sum, b) => sum + b.valueCents, 0), summary.orderValueCents);
  const weekly = fillBuckets(summary.weekly, "weekly", from, to);
  assert.deepEqual(weekly.map((b) => b.key), [...new Set(daily.map((b) => weekKey(new Date(`${b.key}T00:00:00`))))]);
  assert.deepEqual(fillBuckets(summary.monthly, "monthly", from, to).map((b) => b.key), ["2026-10", "2026-11"]);
});

test("topByValue / categoryTotals / normalizeCityRows / barPercent", () => {
  const products = [
    { productId: "a", quantity: 1, valueCents: 500 }, { productId: "b", quantity: 4, valueCents: 500 },
    { productId: "c", quantity: 2, valueCents: 900 }, { productId: "gone", quantity: 1, valueCents: 100 },
  ];
  assert.deepEqual(topByValue(products, 2, (r) => r.productId).map((r) => r.productId), ["c", "b"], "ties by quantity");
  assert.deepEqual(categoryTotals(products, new Map([["a", "Ev"], ["b", "Ev"], ["c", null]]), UNCATEGORIZED_LABEL), [
    { name: "Ev", quantity: 5, valueCents: 1000 }, { name: UNCATEGORIZED_LABEL, quantity: 3, valueCents: 1000 },
  ]);
  assert.deepEqual(normalizeCityRows([{ city: "Bakı", orders: BigInt(3) }, { city: "  ", orders: 1 }, { city: null, orders: 2 }]), [
    { city: "Bakı", orders: 3 }, { city: null, orders: 1 }, { city: null, orders: 2 },
  ]);
  assert.equal(barPercent(50, 100), 50);
  assert.equal(barPercent(1, 1000), 2, "a non-zero value is always visible");
});

test("formatAzn: the site-wide money format from lib/price.ts (PRICE-SYMBOL-1; was az-AZ \"1.234,56 ₼\")", () => {
  const expected: Record<number, string> = { 0: "0.00 ₼", 5: "0.05 ₼", 1999: "19.99 ₼", 123456: "1234.56 ₼", 100000000: "1000000.00 ₼" };
  for (const cents of [0, 5, 1999, 123456, 100000000]) assert.equal(formatAzn(cents), expected[cents]);
  assert.match(formatAzn(123456), /₼$/);
  assert.doesNotMatch(formatAzn(123456), /\$|USD|EUR/);
});

// ================================================================= store scoping and queries (stand-in DB)

function standIn(options: { products?: { id: string; name: string; category?: { name: string } | null }[] } = {}) {
  const calls: { method: string; args: unknown }[] = [];
  const db: SalesAnalyticsDb = {
    storeOrder: {
      findMany: async (args) => { calls.push({ method: "storeOrder.findMany", args }); return rows; },
      groupBy: async (args) => { calls.push({ method: "storeOrder.groupBy", args }); return [{ status: "NEW", _count: { _all: 2 }, _sum: { subtotal: "20.00" } }]; },
    },
    orderItem: {
      groupBy: async (args) => { calls.push({ method: "orderItem.groupBy", args }); return [
        { productId: "p1", _sum: { quantity: 3, lineTotal: "30.00" } }, { productId: "p2", _sum: { quantity: 1, lineTotal: "50.00" } }, { productId: "foreign", _sum: { quantity: 9, lineTotal: "900.00" } },
      ]; },
    },
    product: {
      findMany: async (args) => { calls.push({ method: "product.findMany", args }); return options.products ?? [{ id: "p1", name: "Fincan", category: { name: "Mətbəx" } }, { id: "p2", name: "Vaza", category: null }]; },
    },
    $queryRaw: (async (query: Prisma.Sql) => { calls.push({ method: "$queryRaw", args: query }); return [{ city: "Bakı", orders: BigInt(4) }]; }) as SalesAnalyticsDb["$queryRaw"],
  };
  return { db, calls };
}
const start = at("2026-11-01T00:00:00.000Z"), end = at("2026-11-23T23:59:59.999Z");

test("store scoping: every query is limited to the seller's store and the bounded range; nothing else is called", async () => {
  const { db, calls } = standIn();
  const result = await loadVendorSalesAnalytics(db, { storeId: "store-1", start, end, advanced: true });
  assert.deepEqual(calls.map((c) => c.method).sort(), ["$queryRaw", "orderItem.groupBy", "product.findMany", "storeOrder.findMany", "storeOrder.groupBy"]);
  const find = calls.find((c) => c.method === "storeOrder.findMany")!.args as { where: Record<string, unknown>; select: Record<string, unknown> };
  assert.deepEqual(find.where, { storeId: "store-1", createdAt: { gte: start, lte: end } });
  assert.deepEqual(find.select, { status: true, subtotal: true, createdAt: true }, "minimal columns only");
  const items = calls.find((c) => c.method === "orderItem.groupBy")!.args as { where: unknown; by: unknown };
  assert.deepEqual(items.by, ["productId"]);
  assert.deepEqual(items.where, { storeOrder: { storeId: "store-1", createdAt: { gte: start, lte: end }, status: { not: "CANCELLED" } } });
  const products = calls.find((c) => c.method === "product.findMany")!.args as { where: Record<string, unknown> };
  assert.deepEqual(products.where, { id: { in: ["p1", "p2", "foreign"] }, storeId: "store-1" }, "product names only from this store");
  const previous = calls.find((c) => c.method === "storeOrder.groupBy")!.args as { where: { storeId: string; createdAt: { gte: Date; lte: Date } } };
  assert.equal(previous.where.storeId, "store-1");
  assert.equal(previous.where.createdAt.lte.getTime(), start.getTime() - 1);
  const raw = calls.find((c) => c.method === "$queryRaw")!.args as Prisma.Sql;
  assert.match(raw.text, /WHERE so\."storeId" = \$1/);
  assert.match(raw.text, /so\."createdAt" >= \(\$2::timestamptz AT TIME ZONE 'UTC'\)/);
  assert.match(raw.text, /GROUP BY 1 ORDER BY 2 DESC, 1 ASC\s+LIMIT \$4/);
  assert.deepEqual(raw.values, ["store-1", start.toISOString(), end.toISOString(), 6]);
  // A product id that is not in this store (not returned by the store-scoped lookup) is never shown.
  assert.deepEqual(result.topProducts.map((p) => p.name), ["Vaza", "Fincan"]);
  assert.equal(result.categories?.reduce((sum, c) => sum + c.valueCents, 0), 3000 + 5000 + 90000, "category totals keep every item value; an unknown product goes to 'Kateqoriyasız'");
  assert.deepEqual(result.cities, [{ city: "Bakı", orders: 4 }]);
  assert.deepEqual(result.previous, { received: 2, orderValueCents: 2000 });
});

test("without ADVANCED_ANALYTICS: no previous period, no categories, no cities (and no queries for them)", async () => {
  const { db, calls } = standIn();
  const result = await loadVendorSalesAnalytics(db, { storeId: "store-1", start, end, advanced: false });
  assert.deepEqual(calls.map((c) => c.method).sort(), ["orderItem.groupBy", "product.findMany", "storeOrder.findMany"]);
  assert.equal(result.previous, null);
  assert.equal(result.categories, null);
  assert.equal(result.cities, null);
  assert.equal(result.received.received, 6);
  assert.deepEqual((calls.find((c) => c.method === "product.findMany")!.args as { select: unknown }).select, { id: true, name: true });
});

test("no product ordered -> no product lookup at all", async () => {
  const { db, calls } = standIn();
  db.orderItem.groupBy = async (args) => { calls.push({ method: "orderItem.groupBy", args }); return []; };
  const result = await loadVendorSalesAnalytics(db, { storeId: "s", start, end, advanced: false });
  assert.equal(calls.some((c) => c.method === "product.findMany"), false);
  assert.deepEqual(result.topProducts, []);
});

// ================================================================= route and page wiring

test("API: the sales branch caps the range, then adds the analytics for the same store and range", () => {
  const route = read("app/api/vendor/[storeId]/[section]/route.ts");
  const branch = route.slice(route.indexOf('if(section==="sales"){'), route.indexOf('if(section==="settings")'));
  assert.ok(branch.indexOf("analyticsRangeAllowed(start,end)") < branch.indexOf("db.storeOrder.findMany("), "range checked before any query");
  assert.match(branch, /if\(!analyticsRangeAllowed\(start,end\)\)return NextResponse\.json\(\{error:"Tarix aralığı yanlışdır"\},\{status:400\}\);/);
  assert.match(branch, /const analytics=await loadVendorSalesAnalytics\(db,\{storeId,start,end,advanced:advancedAnalytics!==null\}\);/);
  assert.match(branch, /advancedAnalytics,analytics\}\);/);
  // storeId comes from the access check of this route (seller of this store), never from the query string.
  assert.match(route, /const access=await scope\(storeId\);if\(!access\)return NextResponse\.json\(\{error:"Mağazaya giriş icazəsi yoxdur"\},\{status:403\}\)/);
  assert.doesNotMatch(read("lib/vendor-sales-analytics-query.ts"), /\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(|\$executeRaw/, "read-only");
});

test("page keeps the date filter, presets, period switch, CSV, the transfer note and the delivered-sales table", () => {
  const page = read("components/vendor-sales-report.tsx");
  for (const text of ["Başlanğıc tarix", "Bitmə tarixi", ">Tətbiq et<", ">Bu gün<", ">Son 7 gün<", ">Bu ay<", '"Günlük"', '"Həftəlik"', '"Aylıq"', "CSV yüklə", "Dövrlər üzrə satış",
    "Satıcıya edilən köçürmələr hələ sistemdə qeydə alınmır. Ona görə “tamamlanmış ödənişlər” bölməsi göstərilmir; köçürmə məlumatı üçün administratorla əlaqə saxlayın.",
    "Seçilmiş dövrdə çatdırılmış sifariş yoxdur.", "Ödənişi gözlənilən açıq sifarişlər", "Təxmini qazancınız"]) assert.ok(page.includes(text), text);
  assert.match(page, /vendorFinanceCsv\(buckets, periods\[period\]\)/);
  // No card / online payment, free delivery or rating claims.
  assert.doesNotMatch(page, /kartla|onlayn ödəniş|pulsuz çatdırılma|reytinq|ulduz/i);
  // Charts: hand-built, accessible (text label per bar, screen-reader table), no chart package.
  const charts = read("components/vendor-analytics-charts.tsx");
  assert.match(charts, /<title>\{d\.label\}<\/title>/);
  assert.match(charts, /<table className="sr-only">/);
  assert.match(charts, /role="img" aria-label=\{title\}/);
  const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
  assert.equal(Object.keys(pkg.dependencies).some((name) => /chart|recharts|d3|visx|nivo/i.test(name)), false);
});

test("finding 1: the old PRO block no longer repeats the new section; only the low-stock count remains, under the existing heading", () => {
  const block = read("components/vendor-advanced-analytics.tsx");
  for (const removed of ["Orta sifariş məbləği", "Əvvəlki eyni müddət", "Kateqoriyalar üzrə satış", "averageOrderValue", "previousPeriod", "topCategories"]) assert.doesNotMatch(block, new RegExp(removed), removed);
  assert.match(block, />Ətraflı analitika<\/h2>/);
  assert.match(block, />Az stoklu aktiv məhsullar<\/p><b className="mt-2 block text-xl">\{data\.lowStockProducts\}<\/b>/);
  assert.match(block, /type Props = \{ data: \{ lowStockProducts: number \} \};/);
  // The new section keeps its own (received-orders) average; it is the only "Orta sifariş məbləği" on the page now.
  assert.equal(read("components/vendor-sales-report.tsx").match(/AVERAGE_ORDER\b/g)?.length, 3);
});

// ================================================================= texts

test("texts: only the listed new texts appear (diff scan against main); legal pages unchanged", () => {
  const baseText = (path: string) => { try { return execFileSync("git", ["show", `${BASE}:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).replace(/\r\n/g, "\n"); } catch { return ""; } };
  const NEW_TEXTS = [
    "Bu bölmə seçilmiş dövrdə alınan bütün sifarişləri göstərir. Sifarişlərin məbləği ödənilmiş pul deyil: ödəniş təsdiqlənib sifariş çatdırılana qədər satışa daxil edilmir.",
    "Alınan sifarişlər", "ləğv edilib", "Sifarişlərin məbləği", "Ləğv edilənlər daxil deyil", "Ləğv faizi", "sifariş", "əvvəlki eyni müddətə görə",
    "Əvvəlki eyni müddətdə sifariş yoxdur", "Sifarişlər dövrlər üzrə", "Seçilmiş dövrdə sifariş yoxdur.", "Sifariş statusları", "Ən çox sifariş edilən 5 məhsul",
    "Kateqoriyalar üzrə sifarişlər", "Şəhərlər üzrə sifarişlər", "Şəhər qeyd olunmayıb", "Çatdırılmış satış",
  ];
  // Existing texts reused in a new place: each must already exist in the base commit (file named here).
  const REUSED: Array<[string, string]> = [
    ["Ətraflı analitika yalnız PRO paketində mövcuddur.", "lib/subscription-entitlements.ts"],
    ["Orta sifariş məbləği", "components/vendor-advanced-analytics.tsx"],
    ["Sifarişlər", "app/vendor/[storeId]/[section]/page.tsx"],
    ["Kateqoriyasız", "app/api/vendor/[storeId]/[section]/route.ts"],
    ["Tarix aralığı yanlışdır", "app/api/vendor/[storeId]/[section]/route.ts"],
    ["Ödəniş gözləyir", "lib/order-status.ts"], // quoted in a code comment only
  ];
  for (const [text, path] of REUSED) assert.ok(baseText(path).includes(text), `reused text exists before: ${text}`);
  const AZ = /[əğıöüşçƏĞİÖÜŞÇ]/;
  const fragments = (source: string) => new Set(source.split(/["'`<>{}]|\$\{/).map((part) => part.trim()).filter((part) => AZ.test(part)));
  // The files this task changes (an explicit list, so later tasks with their own approved texts do not break this).
  const files = ["components/vendor-sales-report.tsx", "components/vendor-analytics-charts.tsx", "components/vendor-advanced-analytics.tsx", "lib/vendor-sales-analytics.ts", "lib/vendor-sales-analytics-query.ts", "app/api/vendor/[storeId]/[section]/route.ts"];
  for (const path of files) {
    const before = fragments(baseText(path));
    for (const fragment of fragments(read(path))) {
      if (before.has(fragment)) continue;
      const allExisting = [...before].join("\n");
      let rest = fragment;
      for (const text of [...NEW_TEXTS, ...REUSED.map(([reused]) => reused)].sort((a, b) => b.length - a.length)) rest = rest.split(text).join("");
      // Comments and existing words reused in a new place are allowed: every remaining Azerbaijani word must exist before.
      const unknownWords = (rest.match(/[A-Za-zƏəĞğİıÖöÜüŞşÇç]+/g) ?? []).filter((word) => AZ.test(word) && !allExisting.includes(word) && !NEW_TEXTS.some((t) => t.includes(word)));
      assert.deepEqual(unknownWords, [], `${path}: unlisted new text: ${fragment}`);
    }
  }
  const page = read("components/vendor-sales-report.tsx");
  for (const text of NEW_TEXTS) assert.ok(page.includes(text), `listed text is used: ${text}`);
  for (const path of ["app/(customer)/terms/page.tsx", "app/(customer)/privacy/page.tsx", "app/(customer)/seller-terms/page.tsx"]) assert.equal(read(path), baseText(path), path);
});
