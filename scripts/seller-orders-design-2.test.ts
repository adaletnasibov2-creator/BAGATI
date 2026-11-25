/**
 * SELLER-ORDERS-DESIGN-2: product image on every seller order line (detail, list, packing slip) and the "on the way"
 * WhatsApp button (READY / HANDED_TO_COURIER / SHIPPED only). Feature 2 (customer note) was skipped: the database has no customer note field (see the report).
 * Exact wa.me link with Azerbaijani letters, hidden for a bad/landline/missing phone and for closed orders, no status
 * change, store scoping, one query for images, texts, and admin/public files untouched. Live check: see the report.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildOnTheWayWhatsAppUrl, canSendOnTheWay, ON_THE_WAY_STATUSES } from "../lib/seller-on-the-way";
import { itemThumbnail, SELLER_ORDERS_DESIGN_2_TEXT } from "../lib/vendor-order-view";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const BASE = "67a98bb";
const baseFile = (path: string) => { try { return execFileSync("git", ["show", `${BASE}:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).replace(/\r\n/g, "\n"); } catch { return ""; } };
const PAGE = "app/vendor/[storeId]/orders/[storeOrderId]/page.tsx";
const LIST = "components/vendor-orders.tsx";
const ROUTE = "app/api/vendor/[storeId]/[section]/route.ts";
const ORDER_ID = "cmwuxn36p0018b7i4yzbd6r5w";
const OPEN = { status: "SHIPPED", shipmentStatus: "IN_TRANSIT" };
const STORE = "Gözəl Çiçək Şüşə Ağacı";

// ---------------------------------------------------------------- on the way: link

test("on the way: exact wa.me link, digits only, Azerbaijani letters URL-encoded", () => {
  assert.equal(SELLER_ORDERS_DESIGN_2_TEXT.onTheWayButton, "Alıcıya “Yoldadır” yaz", "approved label");
  const url = buildOnTheWayWhatsAppUrl("055 123 45 67", STORE, ORDER_ID, OPEN)!;
  const message = "Salam! Gözəl Çiçək Şüşə Ağacı mağazasından #YZBD6R5W sifarişiniz yoldadır. Təşəkkür edirik!";
  assert.equal(url, `https://wa.me/994551234567?text=${encodeURIComponent(message)}`);
  assert.equal(url, "https://wa.me/994551234567?text=Salam!%20G%C3%B6z%C9%99l%20%C3%87i%C3%A7%C9%99k%20%C5%9E%C3%BC%C5%9F%C9%99%20A%C4%9Fac%C4%B1%20ma%C4%9Fazas%C4%B1ndan%20%23YZBD6R5W%20sifari%C5%9Finiz%20yoldad%C4%B1r.%20T%C9%99%C5%9F%C9%99kk%C3%BCr%20edirik!");
  assert.match(url, /^[\x21-\x7e]+$/, "ASCII only, no spaces");
  const parsed = new URL(url);
  assert.equal(parsed.host, "wa.me");
  assert.equal(parsed.searchParams.get("text"), message, "decodes back to the same text (ə ı ö ü ğ ş ç)");
  for (const letter of ["ə", "ı", "ö", "ü", "ğ", "ş", "ç"]) assert.ok(parsed.searchParams.get("text")!.includes(letter), letter);
  // "#" must be encoded, or wa.me would drop the rest of the message as a URL fragment.
  assert.equal(parsed.hash, "");
  // Same number in every accepted format.
  for (const phone of ["+994551234567", "+994 55 123 45 67", "994551234567", "00994551234567", "(055) 123-45-67"]) assert.equal(buildOnTheWayWhatsAppUrl(phone, STORE, ORDER_ID, OPEN), url, phone);
});

test("on the way: the message holds only greeting, store name, order number and 'on the way'", () => {
  const text = new URL(buildOnTheWayWhatsAppUrl("+994501112233", "Mağaza", ORDER_ID, OPEN)!).searchParams.get("text")!;
  assert.equal(text, SELLER_ORDERS_DESIGN_2_TEXT.onTheWayMessage("Mağaza", "#YZBD6R5W"));
  assert.doesNotMatch(text, /501112233|994|AZN|₼|qiymət|ödəniş|ödənil|saat|dəqiqə|gün|bu gün|sabah/i, "no phone, price, payment or time");
  // Whitespace in the store name is collapsed; an empty name gives no button.
  assert.match(new URL(buildOnTheWayWhatsAppUrl("+994501112233", "  A \n  B  ", ORDER_ID, OPEN)!).searchParams.get("text")!, /Salam! A B mağazasından/);
  assert.equal(buildOnTheWayWhatsAppUrl("+994501112233", "   ", ORDER_ID, OPEN), null);
});

test("on the way: missing, invalid or landline phone hides the button", () => {
  for (const phone of [null, undefined, "", "  ", "abc", "12345", "+7 912 345 67 89", "+994 12 345 67 89", "012 345 67 89", "+99455123456"]) {
    assert.equal(buildOnTheWayWhatsAppUrl(phone, STORE, ORDER_ID, OPEN), null, String(phone));
  }
});

test("on the way: shown only for READY, HANDED_TO_COURIER and SHIPPED (every order status checked)", () => {
  // Every OrderStatus value in prisma/schema.prisma.
  const enumBlock = read("prisma/schema.prisma").match(/enum OrderStatus \{([^}]*)\}/)![1];
  const all = enumBlock.split(/\s+/).filter(Boolean);
  assert.deepEqual(all, ["PENDING", "NEW", "CONFIRMED", "PREPARING", "READY", "HANDED_TO_COURIER", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED"]);
  assert.deepEqual([...ON_THE_WAY_STATUSES], ["READY", "HANDED_TO_COURIER", "SHIPPED"]);
  const expected: Record<string, boolean> = { PENDING: false, NEW: false, CONFIRMED: false, PREPARING: false, READY: true, HANDED_TO_COURIER: true, PROCESSING: false, SHIPPED: true, DELIVERED: false, CANCELLED: false, RETURNED: false };
  for (const status of all) {
    assert.equal(canSendOnTheWay({ status, shipmentStatus: null }), expected[status], status);
    assert.equal(Boolean(buildOnTheWayWhatsAppUrl("+994551234567", STORE, ORDER_ID, { status, shipmentStatus: null })), expected[status], `${status} link`);
  }
});

test("on the way: a delivered or returned shipment hides it even for an allowed status; other shipment states keep it", () => {
  const shipments = read("prisma/schema.prisma").match(/enum ShipmentStatus \{([^}]*)\}/)![1].split(/\s+/).filter(Boolean);
  assert.deepEqual(shipments, ["PREPARING", "READY_FOR_SHIPMENT", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "DELIVERY_FAILED", "RETURNED"]);
  for (const status of ON_THE_WAY_STATUSES) for (const shipmentStatus of [null, undefined, ...shipments]) {
    const shown = shipmentStatus !== "DELIVERED" && shipmentStatus !== "RETURNED";
    assert.equal(canSendOnTheWay({ status, shipmentStatus }), shown, `${status}/${shipmentStatus}`);
    assert.equal(Boolean(buildOnTheWayWhatsAppUrl("+994551234567", STORE, ORDER_ID, { status, shipmentStatus })), shown, `${status}/${shipmentStatus} link`);
  }
});

test("on the way: the page shows it as a plain link (new tab, noopener) and never changes the status", () => {
  const page = read(PAGE);
  assert.match(page, /buildOnTheWayWhatsAppUrl\(customerPhone, order\.store\?\.name \?\? "", order\.order\.id, order\)/);
  const link = page.split("\n").find((line) => line.includes("data-on-the-way"))!;
  assert.ok(link, "button rendered");
  assert.match(link, /^\s*\{onTheWayWhatsApp && <a href=\{onTheWayWhatsApp\} target="_blank" rel="noopener noreferrer"/);
  assert.match(link, /min-h-11/, "44 px tap target");
  assert.doesNotMatch(link, /onClick|fetch|PATCH|status/);
  // The store name comes from this store order's own relation, in the same query.
  assert.match(page, /store: \{ select: \{ name: true \} \},/);
  // The client list never loads the phone parser or the builder.
  for (const path of [LIST, "lib/vendor-order-view.ts"]) assert.doesNotMatch(read(path), /az-phone|seller-on-the-way/, path);
});

// ---------------------------------------------------------------- images

test("thumbnail: first non-empty image only; deleted/empty product gives the placeholder", () => {
  assert.equal(itemThumbnail({ product: { images: ["https://cdn.shopbagati.com/a.webp", "https://cdn.shopbagati.com/b.webp"] } }), "https://cdn.shopbagati.com/a.webp");
  assert.equal(itemThumbnail({ product: { images: ["", "https://cdn.shopbagati.com/b.webp"] } }), "https://cdn.shopbagati.com/b.webp");
  for (const item of [{ product: { images: [] } }, { product: { images: null } }, { product: null }, {}]) assert.equal(itemThumbnail(item), null);
});

test("detail page: one scoped query loads the images; another store's order is 404", () => {
  const page = read(PAGE);
  assert.match(page, /db\.storeOrder\.findFirst\(\{\n\s+where: \{ id: storeOrderId, storeId: access\.storeId \},/, "store scope");
  assert.match(page, /if \(!order\) notFound\(\);/);
  assert.match(page, /items: \{ include: \{ variant: \{ select: \{ name: true, options: true \} \}, product: \{ select: \{ images: true \} \} \} \},/);
  assert.doesNotMatch(page, /db\.product\.|prisma\.product\./, "no per-line product lookup");
  assert.match(page, /<img src=\{image\} alt=\{item\.productName\} width=\{64\} height=\{64\} loading="lazy" className="h-full w-full object-cover"\/>/);
  assert.match(page, /<ImageOff aria-hidden="true"/, "existing placeholder icon");
});

test("list: images in the same query, only the first URL is sent, 40 px thumbnail with placeholder", () => {
  const route = read(ROUTE);
  assert.match(route, /const rows=await db\.storeOrder\.findMany\(\{where,include:\{items:\{select:\{id:true,productName:true,quantity:true,variant:\{select:\{name:true,options:true\}\},product:\{select:\{images:true\}\}\}\}/);
  assert.match(route, /items:row\.items\.map\(\(\{product,\.\.\.item\}:\{product:\{images:string\[\]\}\|null;\[key:string\]:unknown\}\)=>\(\{\.\.\.item,image:itemThumbnail\(\{product\}\)\}\)\)/, "full image list never leaves the server");
  assert.match(route, /const where=vendorOrderWhere\(storeId,/, "store scope unchanged");
  const list = read(LIST);
  assert.match(list, /<img src=\{first\.image\} alt=\{first\.productName\} width=\{40\} height=\{40\} loading="lazy" className="h-full w-full object-cover"\/>/);
  assert.match(list, /data-order-thumb="" className="grid h-10 w-10 shrink-0/);
  assert.match(list, /<ImageOff aria-hidden="true" size=\{16\}/);
  assert.equal(list.match(/\{thumbnail\(order\)\}/g)?.length, 2, "table and cards");
});

test("packing slip: small fixed-size image, no lazy loading, rows never split", () => {
  const page = read(PAGE);
  const slip = page.slice(page.indexOf("data-order-packing-slip"));
  assert.match(slip, /<span className="block h-\[12mm\] w-\[12mm\] shrink-0 overflow-hidden border border-gray-400">/);
  assert.match(slip, /<img src=\{image\} alt=\{item\.productName\} width=\{45\} height=\{45\} className="h-full w-full object-cover"\/>/);
  assert.match(read("app/globals.css"), /\[data-order-packing-slip\] tr \{ break-inside: avoid; \}/);
});

// ---------------------------------------------------------------- texts and untouched files

const AZ = /[əğıöşüçƏĞİÖŞÜÇ]/;
const fragments = (source: string) => new Set(source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*\*|\{\/\*)/.test(line)).join("\n").split(/["'`<>{}]|\$\{/).map((part) => part.trim()).filter((part) => AZ.test(part)));

test("texts: the only new visible words are the button label and the message", () => {
  const changed = [PAGE, LIST, ROUTE, "lib/vendor-order-view.ts", "lib/seller-on-the-way.ts"];
  const added = new Set(changed.flatMap((path) => { const before = fragments(baseFile(path)); return [...fragments(read(path))].filter((fragment) => !before.has(fragment)); }));
  // ("Salam! " has no Azerbaijani-only letter, so the fragment scan does not list it; the exact message is pinned above.)
  assert.deepEqual([...added].sort(), ["Alıcıya “Yoldadır” yaz", "mağazasından", "sifarişiniz yoldadır. Təşəkkür edirik!"].sort());
});

test("admin, public and legal files untouched by this task (main 67a98bb -> task commit 8484ba6)", () => {
  // Compares the task's own commit, so later tasks (e.g. PRICE-SYMBOL-1) can change these files on purpose.
  const TASK = "8484ba6";
  const diff = execFileSync("git", ["diff", "--name-only", BASE, TASK, "--", "app/admin", "app/(customer)", "components/admin-ui", "app/globals.css", "prisma"], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(diff, "");
  const all = execFileSync("git", ["diff", "--name-only", BASE, TASK], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
  for (const path of all) assert.ok([PAGE, LIST, ROUTE, "lib/vendor-order-view.ts", "lib/seller-on-the-way.ts", "scripts/seller-orders-design-2.test.ts"].includes(path) || path.startsWith("scripts/"), path);
});
