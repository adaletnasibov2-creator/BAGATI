/**
 * PRICE-SYMBOL-1: one money format for customers and sellers, "42.90 ₼" (lib/price.ts). The helper's output, no
 * "AZN" display text and no locale (Intl) money formatting left in customer/seller screens, the places that keep "AZN"
 * as a code unchanged, only the unit swapped inside existing sentences, PULSUZ rules unchanged, admin and legal
 * pages untouched. Live check: see the report.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { formatPrice, formatPriceCents, priceAmount, PRICE_SYMBOL } from "../lib/price";
import { formatAzn } from "../lib/vendor-sales-analytics";
import { formatMoney } from "../lib/format-money";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const BASE = "c727d9d";
const baseFile = (path: string) => { try { return execFileSync("git", ["show", `${BASE}:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).replace(/\r\n/g, "\n"); } catch { return ""; } };
const LEGAL = ["app/(customer)/terms/page.tsx", "app/(customer)/privacy/page.tsx", "app/(customer)/seller-terms/page.tsx"];
const CHANGED = ["app/(customer)/orders/[orderId]/page.tsx", "app/vendor/[storeId]/orders/[storeOrderId]/page.tsx", "app/vendor/[storeId]/page.tsx", "components/cart-page-client.tsx", "components/checkout-form.tsx", "components/product-card.tsx", "components/vendor-campaign-manager.tsx", "components/vendor-store-profile-editor.tsx", "lib/vendor-sales-analytics.ts", "lib/price.ts"];

// ---------------------------------------------------------------- the helper

test("formatPrice: 2 decimals with a dot, a space, ₼; numbers, strings and Decimal-like values", () => {
  assert.equal(PRICE_SYMBOL, "₼");
  assert.equal(formatPrice(42.9), "42.90 ₼");
  assert.equal(formatPrice("42.9"), "42.90 ₼", "the card's String(number) price");
  assert.equal(formatPrice("42.90"), "42.90 ₼");
  assert.equal(formatPrice({ toString: () => "9.99" }), "9.99 ₼", "Prisma Decimal via toString");
  assert.equal(formatPrice(0), "0.00 ₼", "delivery 0 shows the amount, not PULSUZ");
  assert.equal(formatPrice("0.00"), "0.00 ₼");
  assert.equal(formatPrice(1234567.5), "1234567.50 ₼", "no thousands grouping (same as every existing toFixed(2) ₼)");
  assert.equal(formatPrice(-5), "-5.00 ₼");
  assert.equal(formatPrice(-0.001), "0.00 ₼", "no -0.00");
  assert.equal(formatPrice(0.005), "0.01 ₼");
  for (const value of [null, undefined, "", "abc", Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(formatPrice(value), "—", String(value));
  assert.equal(formatPrice(null, ""), "");
  assert.equal(priceAmount(42.9), "42.90");
  assert.equal(formatPriceCents(4290), "42.90 ₼");
  assert.equal(formatPriceCents(1), "0.01 ₼");
  assert.equal(formatPriceCents(0), "0.00 ₼");
  for (const value of [null, undefined, Number.NaN]) assert.equal(formatPriceCents(value as number | null | undefined), "—");
  assert.match(formatPrice(42.9), /^42\.90 ₼$/, "a plain space (U+0020), like the existing ₼ prices");
});

test("formatPrice gives exactly the text of the existing `toFixed(2) ₼` prices (2,000 generated amounts)", () => {
  let seed = 7;
  const next = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let run = 0; run < 2000; run++) {
    const cents = Math.floor(next() * 10_000_000);
    const text = (cents / 100).toFixed(2);
    assert.equal(formatPrice(text), `${Number(text).toFixed(2)} ₼`);
    assert.equal(formatPriceCents(cents), `${text} ₼`);
  }
});

test("seller analytics formatAzn now uses the same helper", () => {
  for (const cents of [0, 5, 1999, 123456]) assert.equal(formatAzn(cents), formatPriceCents(cents));
  assert.match(read("lib/vendor-sales-analytics.ts"), /export function formatAzn\(cents: number\): string \{\n {2}return formatPriceCents\(cents\);\n\}/);
});

// ---------------------------------------------------------------- customer and seller screens

function walk(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(join(root, path)).isDirectory() ? walk(path) : /\.(tsx|ts)$/.test(name) ? [path] : [];
  });
}
/** Customer and seller UI sources (not admin, not API, not legal pages). */
const UI = [...walk("app/(customer)"), ...walk("app/vendor"), ...walk("components").filter((path) => !/^components\/admin/.test(path))].filter((path) => !LEGAL.includes(path));
const code = (source: string) => source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*\*|\{\/\*)/.test(line)).join("\n");

test("no 'AZN' display text left in customer and seller screens (only the listed code/column-name uses)", () => {
  assert.ok(UI.length > 100, `${UI.length} files scanned`);
  const allowed: Record<string, RegExp> = {
    // The payment line: "AZN" is the stored currency code being compared, the amount itself uses formatPrice.
    "app/(customer)/orders/[orderId]/page.tsx": /payment\.currency==="AZN"\?formatPrice\(payment\.amount\)/,
    // Import screen: names of the spreadsheet template's columns (lib/catalog-import-template.ts), kept on purpose.
    "components/vendor-import.tsx": /price: "Qiymət \(AZN\)", discountPrice: "Endirimli qiymət \(AZN\)"/,
  };
  for (const path of UI) {
    const source = code(read(path));
    const hits = source.match(/AZN/g)?.length ?? 0;
    if (!hits) continue;
    assert.ok(allowed[path], `${path}: AZN shown as text`);
    assert.match(source, allowed[path], path);
    assert.equal(hits, path === "components/vendor-import.tsx" ? 2 : 1, path);
  }
});

test("no locale/Intl money formatting in customer and seller screens (its text differs between browsers)", () => {
  for (const path of UI) {
    const source = read(path);
    assert.doesNotMatch(source, /style:\s*"currency"/, path);
    assert.doesNotMatch(source, /toLocaleString\("az-AZ", \{ minimumFractionDigits: 2/, path);
  }
});

test("cart, checkout, card and order pages use the helper; PULSUZ rules unchanged", () => {
  const cart = read("components/cart-page-client.tsx");
  assert.match(cart, /const money = \(value: number\) => formatPrice\(value\);/);
  assert.match(cart, /\{group\.delivery\.freeDelivery \? "PULSUZ" : money\(group\.delivery\.deliveryFeeCents \/ 100\)\}/);
  assert.match(cart, /\{centsToFixed\(group\.delivery\.freeDeliveryThresholdCents\)\} ₼ və yuxarı sifarişlərdə çatdırılma pulsuzdur\./);
  assert.match(cart, /Pulsuz çatdırılmaya \{centsToFixed\(remainingForFreeDeliveryCents\(group\.delivery\)!\)\} ₼ qaldı/);
  const form = read("components/checkout-form.tsx");
  assert.match(form, /\{store\.freeDelivery\?"PULSUZ":formatPrice\(store\.deliveryFee\)\}/);
  assert.match(form, /showFreeDeliveryThresholdNote\(\{freeDelivery:store\.freeDelivery,deliveryFeeCents:Math\.round\(store\.deliveryFee\*100\)\}\)&&/, "threshold sentence rule unchanged");
  for (const pin of ["{formatPrice(item.lineTotal)}", "{formatPrice(item.basePrice*item.quantity)}", "Məhsullar: {formatPrice(store.subtotal)}", "Mağaza cəmi: {formatPrice(store.storeTotal)}"]) assert.ok(form.includes(pin), pin);
  const card = read("components/product-card.tsx");
  assert.match(card, /\{formatPrice\(price\)\}/);
  assert.match(card, /\{formatPrice\(originalPrice\)\}/);
  const customer = read("app/(customer)/orders/[orderId]/page.tsx");
  for (const pin of ["Məhsullar: {formatPrice(group.subtotal)} · Çatdırılma: {formatPrice(group.deliveryFee ?? 0)} · Mağaza cəmi: {formatPrice(Number(group.subtotal)+Number(group.deliveryFee ?? 0))}", "{formatPrice(order.total)}", "{formatPrice(item.lineTotal)}"]) assert.ok(customer.includes(pin), pin);
  const seller = read("app/vendor/[storeId]/orders/[storeOrderId]/page.tsx");
  for (const pin of ["{formatPrice(order.subtotal)}", "{formatPrice(order.deliveryFee ?? 0)}", "{formatPrice(storeOrderTotal(order))}"]) assert.ok(seller.includes(pin), pin);
  const dashboard = read("app/vendor/[storeId]/page.tsx");
  for (const pin of ["value: formatPrice(salesAmount)", "{formatPrice(order.subtotal)}", "{formatPrice(product.price)} <Badge"]) assert.ok(dashboard.includes(pin), pin);
});

test("seller input labels: (AZN) -> (₼) only where the product forms already say 'Qiymət (₼)'", () => {
  assert.match(read("components/vendor-product-editor.tsx"), /Qiymət \(₼\)<input/, "existing label kind");
  assert.match(read("components/vendor-campaign-manager.tsx"), /<option value="FIXED">Sabit məbləğ \(₼\)<\/option>/);
  assert.match(read("components/vendor-campaign-manager.tsx"), /"Endirim məbləği \(₼\)"/);
  assert.match(read("components/vendor-store-profile-editor.tsx"), /Pulsuz çatdırılma həddi \(₼\)<input[\s\S]*Həddən aşağı çatdırılma haqqı \(₼\)<input/);
});

// ---------------------------------------------------------------- kept as code, texts, untouched files

test("'AZN' kept where it is a code: e-mails, Epoint, JSON-LD, API order payment, CSV, import template, admin format", () => {
  for (const path of ["lib/email-templates.ts", "lib/payments/epoint-protocol.ts", "lib/payments/epoint-checkout.ts", "lib/structured-data.ts", "app/api/orders/route.ts", "lib/vendor-finance.ts", "lib/catalog-import-template.ts", "components/vendor-import.tsx", "lib/format-money.ts", "lib/delivery-cents.ts"]) {
    assert.equal(read(path), baseFile(path), `${path} unchanged`);
  }
  assert.match(read("lib/structured-data.ts"), /priceCurrency: "AZN"/);
  assert.equal(formatMoney(12.5), "12,50 AZN", "admin format unchanged");
});

const AZ = /[əğıöşüçƏĞİÖŞÜÇ₼]/;
const fragments = (source: string) => new Set(code(source).split(/["'`<>{}]|\$\{/).map((part) => part.trim()).filter((part) => AZ.test(part)));

test("texts: no new words; only the unit AZN -> ₼ swapped inside existing labels and sentences", () => {
  // The unit token (AZN or ₼) is ignored on both sides: "AZN · Çatdırılma:" -> "· Çatdırılma:" is the same words.
  const words = (fragment: string) => fragment.replace(/\bAZN\b|₼/g, " ").replace(/\s+/g, " ").trim();
  const added = CHANGED.flatMap((path) => {
    const before = new Set([...fragments(baseFile(path))].map(words));
    return [...fragments(read(path))].map(words).filter((fragment) => fragment && !before.has(fragment)).map((fragment) => `${path}: ${JSON.stringify(fragment)}`);
  });
  assert.deepEqual(added, []);
});

test("admin and legal pages untouched since main; no migration", () => {
  const diff = execFileSync("git", ["diff", "--name-only", BASE, "--", "app/admin", "components/admin-ui", "prisma", ...LEGAL], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(diff, "");
  const admin = readdirSync(join(root, "components")).filter((name) => name.startsWith("admin")).map((name) => `components/${name}`);
  for (const path of admin) if (statSync(join(root, path)).isFile()) assert.equal(read(path), baseFile(path), path);
});
