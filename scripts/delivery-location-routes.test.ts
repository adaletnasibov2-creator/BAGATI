/**
 * Delivery location wiring (source-level): address APIs, order creation, seller and admin pages. The pure rules are
 * covered by delivery-location.test.ts.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { readOrderCoordinates } from "../lib/delivery-location";
import { createOrderAddressSnapshot } from "../lib/order-address-snapshot";

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");

test("address APIs: a pin outside Azerbaijan is refused (422) and a valid pin is stored rounded", () => {
  for (const file of ["app/api/account/addresses/route.ts", "app/api/account/addresses/[addressId]/route.ts"]) {
    const source = read(file);
    const pairCheck = source.indexOf("Xəritə koordinatları birlikdə daxil edilməlidir");
    const boxCheck = source.indexOf("const pin = normalizeDeliveryCoordinates(parsed.data.latitude, parsed.data.longitude);");
    const write = source.search(/tx\.address\.(create|update)\(/);
    assert.ok(pairCheck > 0 && boxCheck > pairCheck && write > boxCheck, `${file}: pair check -> box check -> write`);
    assert.match(source, /if \(!pin\) return NextResponse\.json\(\{ error: OUTSIDE_AZERBAIJAN_MESSAGE \}, \{ status: 422 \}\);/);
    assert.match(source, /Object\.assign\(parsed\.data, pin\);/);
    // Addresses without a pin keep working: the box check only runs when a latitude is sent.
    assert.match(source, /if \(parsed\.data\.latitude != null\) \{/);
  }
});

// Order creation: the route reads the optional pin with readOrderCoordinates(raw) and passes `selected` to
// createOrderAddressSnapshot(address, selected). These run that exact pair for every kind of checkout body.

const savedAddress = (pin: { latitude: number | null; longitude: number | null } = { latitude: null, longitude: null }) =>
  ({ recipientName: "Alıcı", phone: "+994000000", line1: "Nizami küç. 1", line2: "2-ci giriş", postalCode: null, ...pin, city: { name: "Bakı" } });
const snapshotFor = (body: unknown, address = savedAddress()) => createOrderAddressSnapshot(address, readOrderCoordinates(body).selected);
const TEXT_ONLY = { recipientName: "Alıcı", phone: "+994000000", line1: "Nizami küç. 1", line2: "2-ci giriş", postalCode: null, city: "Bakı" };

test("order: the address-text-only checkout gives exactly today's snapshot (no coordinate keys)", () => {
  // What checkout-form.tsx sends without a pin, and an older client that sends no coordinate keys at all.
  assert.deepEqual(snapshotFor({ addressId: "a", latitude: null, longitude: null, expectedPrices: [] }), TEXT_ONLY);
  assert.deepEqual(snapshotFor({ addressId: "a" }), TEXT_ONLY);
});

test("order: an invalid, half-filled or foreign pin is dropped and the order snapshot is the address text only", () => {
  for (const body of [
    { addressId: "a", latitude: 40.4093, longitude: null },
    { addressId: "a", latitude: 91, longitude: 200 },
    { addressId: "a", latitude: 51.5, longitude: -0.12 },
    { addressId: "a", latitude: "40.4", longitude: "49.8" },
    { addressId: "a", latitude: Number.NaN, longitude: 49.8 },
  ]) {
    assert.deepEqual(snapshotFor(body), TEXT_ONLY, JSON.stringify(body));
    // A pin saved on the address is not used either: the customer's explicit (bad) choice means "no pin".
    assert.deepEqual(snapshotFor(body, savedAddress({ latitude: 40.4, longitude: 49.8 })), TEXT_ONLY, `saved pin, ${JSON.stringify(body)}`);
  }
});

test("order: a valid pin is stored rounded; a saved pin is reused only when it is inside Azerbaijan", () => {
  assert.deepEqual(snapshotFor({ addressId: "a", latitude: 40.409312345, longitude: 49.867098765 }), { ...TEXT_ONLY, latitude: 40.409312, longitude: 49.867099 });
  assert.deepEqual(snapshotFor({ addressId: "a" }, savedAddress({ latitude: 40.4, longitude: 49.8 })), { ...TEXT_ONLY, latitude: 40.4, longitude: 49.8 });
  assert.deepEqual(snapshotFor({ addressId: "a" }, savedAddress({ latitude: 51.5, longitude: -0.12 })), TEXT_ONLY, "old foreign saved pin");
});

test("order route: coordinates are read before the transaction and can no longer cause a 400/422", () => {
  const route = read("app/api/orders/route.ts");
  const schema = route.match(/^const schema = z\.object\(\{.*\}\);$/m)?.[0] ?? "";
  assert.ok(schema, "schema found");
  assert.doesNotMatch(schema, /latitude|longitude/, "the zod schema no longer validates (and so cannot reject) the pin");
  assert.doesNotMatch(schema, /\.strict\(\)/, "unknown keys (the pin) are ignored by the schema");
  assert.doesNotMatch(route, /Xəritə koordinatları birlikdə daxil edilməlidir/);
  const pinRead = route.indexOf("const coordinatePin=readOrderCoordinates(raw);");
  const transaction = route.indexOf("db.$transaction(");
  assert.ok(pinRead > 0 && pinRead < transaction, "pin read once, before the transaction");
  // PHONE-REQUIRED-1: the snapshot gets the normalized phone; the pin argument is unchanged.
  assert.match(route, /const addressSnapshot=createOrderAddressSnapshot\(\{\.\.\.address,phone:orderPhone\},coordinatePin\.selected\);/);
  assert.equal(route.match(/coordinatePin/g)?.length, 2, "the pin is used only for the address snapshot");
});

test("checkout: the pin is optional and never blocks ordering (no confirm step); text-only body unchanged", () => {
  const form = read("components/checkout-form.tsx");
  assert.doesNotMatch(form, /locationConfirmed|Mövqeyi təsdiqlə|xəritə mövqeyini təsdiqləyin/);
  const placeOrder = form.slice(form.indexOf("async function placeOrder(){"), form.indexOf("return <div"));
  // Before the order request the only early stops are "no address selected" and (legal Phase B) the unticked terms
  // checkbox while the current customer terms are not accepted, and (PHONE-REQUIRED-1) a selected address whose phone is
  // not a valid mobile number; nothing about the map can stop the order.
  const beforeRequest = placeOrder.slice(0, placeOrder.indexOf('await fetch("/api/orders"'));
  assert.deepEqual(beforeRequest.match(/return/g), ["return", "return", "return"]);
  assert.match(beforeRequest, /if\(chosen&&!normalizeAzMobilePhone\(chosen\.phone\)\)\{fixAddressPhone\(chosen\);return\}/);
  assert.match(placeOrder, /if\(!selected\)\{setError\("Çatdırılma ünvanı seçin\."\);return\}/);
  assert.match(placeOrder, /if\(termsRequired&&!acceptTerms\)\{setTermsError\(TERMS_ERROR\);[^}]*return\}/);
  assert.doesNotMatch(beforeRequest, /location/, "the map pin never stops the order");
  assert.match(placeOrder, /body:JSON\.stringify\(\{addressId:selected,latitude:location\?\.latitude\?\?null,longitude:location\?\.longitude\?\?null,expectedPrices,\.\.\.\(termsRequired&&acceptTerms\?\{acceptTerms:true\}:\{\}\)\}\)/);
  assert.equal(form.match(/<DeliveryLocationPicker /g)?.length, 2);
  assert.match(form, /Əlavə məlumat \(bina, mərtəbə, giriş\)<input value=\{line2\}/);
});

test("picker: 'Mənim yerim' asks for the location only on tap; a foreign point is not kept and the customer is told", () => {
  const picker = read("components/delivery-location-picker.tsx");
  assert.match(picker, /^"use client";/);
  assert.match(picker, /onClick=\{locate\}[^>]*>\{locating \? "Mövqe alınır…" : "Mənim yerim"\}/);
  assert.equal(picker.match(/navigator\.geolocation\.getCurrentPosition/g)?.length, 1);
  assert.doesNotMatch(picker.slice(0, picker.indexOf("function locate")), /navigator\.geolocation/, "no location request on render");
  assert.match(picker, /const pin = normalizeDeliveryCoordinates\(point\.latitude, point\.longitude\);\n\s*if \(!pin\) \{\n\s*onChange\(null\);/);
  assert.match(picker, /Azərbaycan ərazisindən kənardadır/);
  assert.match(picker, /Nöqtəni sil/);
  assert.doesNotMatch(picker, /fetch\(|nominatim/i, "no network calls (no reverse geocoding)");
});

test("seller order page: pin and dispatch menu only while the seller may see them; address text always", () => {
  const page = read("app/vendor/[storeId]/orders/[storeOrderId]/page.tsx");
  assert.match(page, /where: \{ id: storeOrderId, storeId: access\.storeId \}/, "scoped to the seller's own store");
  assert.match(page, /const locationAccess = sellerCanSeeDeliveryLocation\(order\);/);
  assert.match(page, /const pin = locationAccess \? deliveryView\.coordinates : null;/);
  assert.match(page, /const dispatchLinks = locationAccess && addressLines\.length \? buildDispatchLinks\(deliveryView, order\.order\.id\) : null;/);
  assert.match(page, /\{pin&&<section className=\{panel\}>/);
  assert.match(page, /<VendorDeliveryAddressMenu links=\{dispatchLinks\} \/>/);
  assert.match(page, /addressLines\.join\(", "\)/, "address text stays");
  assert.doesNotMatch(page, /address\.latitude|address\.longitude/, "the raw snapshot pin is never used directly");
});

test("dispatch menu: portal, plain-text brands, no referrer, Bolt copy message and link", () => {
  const menu = read("components/vendor-delivery-address-menu.tsx");
  assert.match(menu, /createPortal\(/);
  assert.match(menu, /document\.body,\n\s*\)\}/);
  assert.equal(menu.match(/target="_blank" rel="noopener noreferrer"/g)?.length, 7, "Google, OSM, Uber, Waze, WhatsApp, Bolt and the Bolt notice link");
  assert.match(menu, />Google Maps<\/a>/);
  assert.match(menu, />Xəritə \(OpenStreetMap\)<\/a>/);
  assert.match(menu, />Uber<\/a>/);
  assert.match(menu, /Ünvan kopyalandı\. Bolt tətbiqini açın\. <a href=\{bolt\.href\}/);
  // Waze only with a pin; WhatsApp share always (its text has a map link only with a pin); Bolt copies, then opens the store page.
  assert.match(menu, /\{links\.waze && <a role="menuitem" href=\{links\.waze\}/);
  assert.match(menu, /<a role="menuitem" href=\{links\.whatsapp\}[^>]*>.*WhatsApp · Ünvanı göndər<\/a>/);
  assert.match(menu, /<a role="menuitem" href=\{bolt\.href\}[^>]*onClick=\{\(\) => void copy\("bolt"\)\}/);
  // The platform is detected in the browser only.
  assert.match(menu, /useEffect\(\(\) => \{ setPlatform\(detectClientPlatform\(navigator\.userAgent, navigator\.maxTouchPoints\)\); \}, \[\]\);/);
  assert.doesNotMatch(read("lib/bolt-app.ts"), /from "next|headers\(|cookies\(/, "no server logic");
  assert.doesNotMatch(menu, /<img|<svg|<Image|\.(png|svg|jpe?g|webp)"/i, "brand names as text only, no logo images");
  assert.match(menu, /event\.key === "Escape"/);
  assert.match(menu, /buttonRef\.current\?\.focus\(\)/);
});

test("seller shipment API: the shipment status never moves the order status; closed orders refuse shipment changes", () => {
  const route = read("app/api/vendor/[storeId]/[section]/route.ts");
  const orders = route.slice(route.indexOf('if(section==="orders"){\n  const s=z.object('), route.indexOf("OrderFulfillmentError){", route.indexOf('if(section==="orders"){\n  const s=z.object(')));
  assert.match(orders, /const targetOrderStatus=s\.data\.status;/);
  assert.doesNotMatch(orders, /shipmentStatus==="DELIVERED"\?"DELIVERED"/, "no cascade to the order status");
  assert.match(orders, /if\(s\.data\.shipmentStatus&&!shipmentChangeAllowedForOrder\(locked\.status\)\)return \{error:"SHIPMENT_ORDER_CLOSED"\};/);
  assert.match(orders, /Object\.assign\(deliveryData,shipmentTimestamps\(s\.data\.shipmentStatus,locked,new Date\(\)\)\);/);
  // A shipment-only change writes the store order row only (optimistic on status + shipment status), no order transition.
  assert.match(orders, /tx\.storeOrder\.updateMany\(\{where:\{id:locked\.id,storeId,status:locked\.status,shipmentStatus:locked\.shipmentStatus\},data:deliveryData\}\)/);
  assert.match(orders, /if\(targetOrderStatus\)\{\n\s*const transitioned=await transitionVendorStoreOrder\(/);
});

test("seller UI: three steps (Hazırlanır, Yolda, Çatdırıldı); only the next one is enabled; detailed form kept", () => {
  const ui = read("components/vendor-order-actions.tsx");
  assert.match(ui, /SIMPLE_SHIPMENT_STEPS\.map\(/);
  assert.match(ui, /disabled=\{busy \|\| !isNext\}/);
  assert.match(ui, /body: JSON\.stringify\(\{ id: props\.storeOrderId, shipmentStatus: value \}\)/, "shipment only; no order status in the body");
  assert.match(ui, /Ətraflı göndəriş statusu/);
  assert.doesNotMatch(ui, /\["HANDED_TO_COURIER", "SHIPPED"\]\.includes\(props\.status\)/);
});

test("customer order page: 3-step timeline, no coordinates, owner-only query", () => {
  const page = read("app/(customer)/orders/[orderId]/page.tsx");
  assert.match(page, /where:\{id:orderId,userId:user\.id\}/);
  assert.match(page, /\{simpleShipmentTimeline\(group\)\.map\(step=>/);
  assert.doesNotMatch(page, /latitude|longitude|toLocaleString\("az-AZ"\)\}<\/time>/);
  assert.match(page, /group\.shipmentStatus==="DELIVERY_FAILED"/, "the failed-attempt note stays");
});

test("admin shipment API: same-origin -> ADMIN -> bounded body -> validation -> one audited transaction", () => {
  const file = "app/api/admin/store-orders/[storeOrderId]/shipment/route.ts";
  const route = read(file);
  const order = ["csrfRejection(request)", 'requireRole("ADMIN")', "readJsonBodyLimited(request", "bodySchema.safeParse(body.value)", "setShipmentStatusAsAdmin("].map((needle) => route.indexOf(needle));
  assert.ok(order.every((position) => position > 0), "every step present");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in order");
  assert.match(route, /z\.object\(\{ shipmentStatus: z\.enum\(SHIPMENT_STATUSES\) \}\)\.strict\(\)/);
  assert.match(route, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(route, /^export const (?!dynamic)/m, "only route exports");
  const lib = read("lib/shipment-admin.ts");
  assert.match(lib, /SELECT "id" FROM "Order" WHERE "id" = \$\{existing\.orderId\} FOR UPDATE/);
  assert.match(lib, /action: "SHIPMENT_STATUS_UPDATE", entityType: "StoreOrder"/);
  const code = lib.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /enqueueEmail|tx\.order\.(update|create)|tx\.payment|tx\.inventory|tx\.commission|transitionVendorStoreOrder|transitionAdminOrder/, "no e-mail, no order/payment/stock change");
  assert.match(code, /data: \{ shipmentStatus: input\.target, \.\.\.shipmentTimestamps\(input\.target, current, new Date\(\)\) \}/, "writes the shipment fields only");
  const detail = read("app/admin/_sections/order-detail.tsx");
  assert.match(detail, /<AdminShipmentStatusControl storeOrderId=\{group\.id\} shipmentStatus=\{group\.shipmentStatus\} orderStatus=\{group\.status\} \/>/);
});

test("admin order detail: formatted address, coordinates masked in the HTML; reveal is audited", () => {
  const detail = read("app/admin/_sections/order-detail.tsx");
  assert.doesNotMatch(detail, /JSON\.stringify\(order\.addressSnapshot/);
  assert.match(detail, /<AdminCoordinatesReveal orderId=\{order\.id\} masked=\{maskCoordinates\(delivery\.coordinates\)\} \/>/, "only the masked text reaches the client");
  const reveal = read("components/admin-coordinates-reveal.tsx");
  assert.match(reveal, /fetch\(`\/api\/admin\/order-coordinates\/\$\{encodeURIComponent\(orderId\)\}`, \{ method: "POST" \}\)/);
  const route = read("app/api/admin/order-coordinates/[orderId]/route.ts");
  const order = ["csrfRejection(request)", 'requireRole("ADMIN")', "prisma.order.findUnique(", "prisma.auditLog.create(", "NextResponse.json({ latitude:"].map((needle) => route.indexOf(needle));
  assert.ok(order.every((position) => position > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "same-origin -> ADMIN -> lookup -> audit -> response");
  assert.match(route, /prisma\.auditLog\.create\(\{ data: \{ actorId: admin\.id, action: "ORDER_COORDINATES_VIEW", entityType: "Order", entityId: order\.id \} \}\)/, "no coordinates in the audit row");
  assert.match(route, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(route, /^export const (?!dynamic)/m);
});

test("privacy: only the order pages, the reveal API and order creation read the address snapshot", () => {
  const root = join(__dirname, "..");
  const walk = (dir: string): string[] => readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(`${dir}/${entry.name}`) : /\.(ts|tsx)$/.test(entry.name) ? [`${dir}/${entry.name}`] : []);
  const files = ["app", "components", "lib"].flatMap(walk).filter((file) => read(file).includes("addressSnapshot")).sort();
  assert.deepEqual(files, [
    "app/(customer)/orders/[orderId]/page.tsx",      // the customer's own order (text only, no coordinates)
    "app/admin/_sections/order-detail.tsx",          // admin detail (masked)
    "app/api/admin/order-coordinates/[orderId]/route.ts", // audited reveal
    "app/api/orders/route.ts",                       // creation
    "app/vendor/[storeId]/orders/[storeOrderId]/page.tsx", // the store's own order (7-day rule)
    "lib/delivery-location.ts",
    "lib/vendor-sales-analytics-query.ts",           // SELLER-ANALYTICS-1: city name only, counted in SQL (no customer link)
  ]);
  // The seller analytics read ONLY the city field, aggregated (GROUP BY), never the snapshot itself.
  const analytics = read("lib/vendor-sales-analytics-query.ts");
  assert.deepEqual(analytics.match(/"addressSnapshot"[^\s,]*/g), ['"addressSnapshot"->>\'city\'']);
  assert.match(analytics, /SELECT o\."addressSnapshot"->>'city' AS city, COUNT\(\*\)::int AS orders/);
  assert.match(analytics, /GROUP BY 1 ORDER BY 2 DESC, 1 ASC/);
  // E-mails never carry the address or coordinates.
  assert.doesNotMatch(read("lib/email-templates.ts"), /latitude|longitude|addressSnapshot|line1/);
  for (const file of ["app/api/orders/route.ts", "app/api/vendor/[storeId]/[section]/route.ts"]) {
    for (const call of read(file).match(/enqueueEmail\([^;]*\);/g) ?? []) assert.doesNotMatch(call, /latitude|longitude|addressSnapshot|line1/, `${file}: ${call.slice(0, 60)}`);
  }
});

test("map tiles: single OSM host, attribution kept, Leaflet CSS only with the map", () => {
  const surface = read("components/interactive-map-surface.tsx");
  assert.match(surface, /\|\| "https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png";/);
  assert.doesNotMatch(surface, /\{s\}\./);
  assert.match(surface, /OpenStreetMap<\/a> contributors/);
  assert.match(surface, /^import "leaflet\/dist\/leaflet\.css";$/m);
  assert.doesNotMatch(read("app/layout.tsx"), /leaflet/);
  assert.match(read("components/interactive-map.tsx"), /dynamic\(\(\) => import\("@\/components\/interactive-map-surface"\), \{\n\s*ssr: false,/);
});

test("hidden coordinates produce no Waze/WhatsApp location links: the menu is built only under the 7-day rule", () => {
  const page = read("app/vendor/[storeId]/orders/[storeOrderId]/page.tsx");
  // All dispatch links (Waze and WhatsApp included) come from one builder that is only called when the seller may see the pin.
  assert.match(page, /const dispatchLinks = locationAccess && addressLines\.length \? buildDispatchLinks\(deliveryView, order\.order\.id\) : null;/);
  assert.equal(page.match(/buildDispatchLinks\(/g)?.length, 1);
  assert.doesNotMatch(page, /waze\.com|wa\.me\/\?text/, "no link is assembled outside the builder");
});

test("store page: 'WhatsApp ilə yaz' from the shown store phone (tel: link kept); no new numbers exposed", () => {
  const page = read("app/(customer)/stores/[storeId]/page.tsx");
  assert.match(page, /const whatsappUrl = buildWhatsAppUrl\(store\.contactPhone, store\.name\);/);
  assert.match(page, /telHref: buildTelHref\(store\.contactPhone\)/);
  const contact = read("components/storefront-contact.tsx");
  assert.match(contact, />WhatsApp ilə yaz\{info\.phoneDisplay/);
  assert.match(contact, /<a href=\{info\.telHref\}/, "tel: link kept");
  assert.match(read("components/storefront-branding.tsx"), /\/>WhatsApp ilə yaz<\/a>/);
  // The product page shows no store phone today, so it gets no WhatsApp link either.
  assert.doesNotMatch(read("app/(customer)/products/[productId]/page.tsx"), /contactPhone|wa\.me|buildWhatsAppUrl/);
});

test("seller order page: the customer's phone (already shown) is a tel: link plus WhatsApp for mobile numbers", () => {
  const page = read("app/vendor/[storeId]/orders/[storeOrderId]/page.tsx");
  assert.match(page, /const phoneTel = buildTelHref\(customerPhone\);/);
  assert.match(page, /const phoneWhatsApp = buildCustomerWhatsAppUrl\(customerPhone, order\.order\.id\);/);
  assert.match(page, /\{phoneTel \? <a href=\{phoneTel\}/);
  assert.match(page, /\{phoneWhatsApp && <a href=\{phoneWhatsApp\} target="_blank" rel="noopener noreferrer"[^>]*>WhatsApp ilə yaz<\/a>\}/);
  // Same source as before: the order snapshot, else the customer profile. Not subject to the pin's 7-day rule.
  assert.match(page, /const customerPhone = textValue\(address\.phone\) \|\| profile\?\.phone \|\| null;/);
});

test("store header buttons never break their label (they wrap as whole buttons on narrow screens)", () => {
  const branding = read("components/storefront-branding.tsx");
  assert.equal(branding.match(/inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 whitespace-nowrap text-sm font-semibold/g)?.length, 2);
  assert.match(branding, /<div className="flex flex-wrap gap-2 sm:shrink-0 sm:pt-4">/);
});
