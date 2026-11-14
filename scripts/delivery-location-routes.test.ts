/**
 * Delivery location wiring (source-level): address APIs, order creation, seller and admin pages. The pure rules are
 * covered by delivery-location.test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.match(route, /const addressSnapshot=createOrderAddressSnapshot\(address,coordinatePin\.selected\);/);
  assert.equal(route.match(/coordinatePin/g)?.length, 2, "the pin is used only for the address snapshot");
});

test("checkout: the pin is optional and never blocks ordering (no confirm step); text-only body unchanged", () => {
  const form = read("components/checkout-form.tsx");
  assert.doesNotMatch(form, /locationConfirmed|Mövqeyi təsdiqlə|xəritə mövqeyini təsdiqləyin/);
  const placeOrder = form.slice(form.indexOf("async function placeOrder(){"), form.indexOf("return <div"));
  // Before the order request the only early stop is "no address selected"; nothing about the map can stop the order.
  const beforeRequest = placeOrder.slice(0, placeOrder.indexOf('await fetch("/api/orders"'));
  assert.deepEqual(beforeRequest.match(/return/g), ["return"]);
  assert.match(placeOrder, /if\(!selected\)\{setError\("Çatdırılma ünvanı seçin\."\);return\}/);
  assert.match(placeOrder, /body:JSON\.stringify\(\{addressId:selected,latitude:location\?\.latitude\?\?null,longitude:location\?\.longitude\?\?null,expectedPrices\}\)/);
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
  assert.equal(menu.match(/target="_blank" rel="noopener noreferrer"/g)?.length, 4, "Google, OSM, Uber and bolt.eu");
  assert.match(menu, />Google Maps<\/a>/);
  assert.match(menu, />Xəritə \(OpenStreetMap\)<\/a>/);
  assert.match(menu, />Uber<\/a>/);
  assert.match(menu, /Ünvan kopyalandı\. Bolt tətbiqini açın\. <a href="https:\/\/bolt\.eu\/"/);
  assert.doesNotMatch(menu, /<img|<svg|<Image|\.(png|svg|jpe?g|webp)"/i, "brand names as text only, no logo images");
  assert.match(menu, /event\.key === "Escape"/);
  assert.match(menu, /buttonRef\.current\?\.focus\(\)/);
});
