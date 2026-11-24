/**
 * SELLER-CUSTOMER-CARD-1: the seller's customer card and the "Ünvan əməliyyatları" sheet. Exact link per app (with and
 * without a pin), URL-encoding of Azerbaijani text, no customer name/phone in any link, allowed hosts only, the copy
 * helper, initials, the Apple-only row and the unchanged privacy rules. Live check: see the report.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildDispatchLinks, deliveryAddressParts, DISPATCH_LINK_HOSTS, readAddressSnapshot } from "../lib/delivery-location";
import { copyToClipboard } from "../lib/clipboard";
import { customerInitials, SELLER_CUSTOMER_CARD_TEXT } from "../lib/vendor-order-view";
import { isAppleMapsPlatform } from "../lib/bolt-app";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const SECRET = { recipientName: "Gizli Ad Soyad", phone: "+994501112233" };
const withPin = buildDispatchLinks(readAddressSnapshot({ ...SECRET, line1: "Nizami küç. 10, mənzil 5", line2: "2-ci giriş", city: "Bakı", postalCode: "AZ1000", latitude: 40.377712, longitude: 49.892034 }), "cmwuxn36p0018b7i4yzbd6r5w");
const noPin = buildDispatchLinks(readAddressSnapshot({ ...SECRET, line1: "Ağa Nemətulla küç. 44 & 2", city: "Gəncə" }), "cmwuxn371001hb7i4zp9u204l");
const ADDRESS = "A%C4%9Fa%20Nem%C9%99tulla%20k%C3%BC%C3%A7.%2044%20%26%202%2C%20G%C9%99nc%C9%99";

test("with a pin: every app gets the coordinates in its documented format", () => {
  assert.equal(withPin.apps.googleMaps, "https://www.google.com/maps/dir/?api=1&destination=40.377712%2C49.892034&travelmode=driving");
  assert.equal(withPin.apps.waze, "https://waze.com/ul?ll=40.377712,49.892034&navigate=yes");
  assert.equal(withPin.apps.appleMaps, "https://maps.apple.com/directions?destination=40.377712,49.892034&mode=driving");
  assert.equal(withPin.apps.yandexMaps, "https://yandex.ru/maps/?pt=49.892034,40.377712&z=17&l=map", "Yandex pt is longitude first");
  assert.equal(withPin.apps.uber, "https://m.uber.com/looking?drop%5B0%5D=%7B%22latitude%22%3A40.377712%2C%22longitude%22%3A49.892034%2C%22addressLine1%22%3A%22Sifari%C5%9F%20%23YZBD6R5W%22%7D");
  const drop = JSON.parse(new URL(withPin.apps.uber!).searchParams.get("drop[0]")!);
  assert.deepEqual(drop, { latitude: 40.377712, longitude: 49.892034, addressLine1: "Sifariş #YZBD6R5W" }, "label = order number only");
  assert.equal(withPin.uber, withPin.apps.uber);
  assert.equal(withPin.waze, withPin.apps.waze);
  assert.equal(withPin.coordinatesText, "40.377712, 49.892034");
  assert.equal(withPin.addressText, "Nizami küç. 10, mənzil 5, 2-ci giriş, Bakı, AZ1000");
});

test("without a pin: the address text (URL-encoded Azerbaijani letters, & and comma); no Uber; no coordinates", () => {
  assert.equal(noPin.apps.googleMaps, `https://www.google.com/maps/dir/?api=1&destination=${ADDRESS}&travelmode=driving`);
  assert.equal(noPin.apps.waze, `https://waze.com/ul?q=${ADDRESS}`);
  assert.equal(noPin.apps.appleMaps, `https://maps.apple.com/directions?destination=${ADDRESS}&mode=driving`);
  assert.equal(noPin.apps.yandexMaps, `https://yandex.ru/maps/?text=${ADDRESS}`);
  assert.equal(new URL(noPin.apps.yandexMaps).searchParams.get("text"), "Ağa Nemətulla küç. 44 & 2, Gəncə", "decodes back to the exact address");
  assert.equal(new URL(noPin.apps.googleMaps).searchParams.get("destination"), "Ağa Nemətulla küç. 44 & 2, Gəncə");
  assert.equal(noPin.apps.uber, null);
  assert.equal(noPin.uber, null);
  assert.equal(noPin.waze, null, "the old `waze` field stays pin-only for existing callers");
  assert.equal(noPin.coordinatesText, null);
  assert.equal(noPin.addressText, "Ağa Nemətulla küç. 44 & 2, Gəncə");
});

test("privacy: no customer name or phone in any link or copy text; only allowed https hosts", () => {
  for (const links of [withPin, noPin]) {
    const all = [links.googleMaps, links.openStreetMap, links.whatsapp, links.copyText, links.addressText, links.coordinatesText ?? "", ...Object.values(links.apps).filter((v): v is string => Boolean(v))];
    for (const value of all) {
      assert.doesNotMatch(value, /Gizli|Soyad|501112233|994501/, value);
      assert.doesNotMatch(decodeURIComponent(value), /Gizli|Soyad|501112233/, value);
    }
    for (const href of [links.googleMaps, links.openStreetMap, links.whatsapp, ...Object.values(links.apps).filter((v): v is string => Boolean(v))]) {
      const url = new URL(href);
      assert.equal(url.protocol, "https:", href);
      assert.ok((DISPATCH_LINK_HOSTS as readonly string[]).includes(url.hostname), href);
    }
  }
});

test("admin links unchanged (the admin coordinates card still uses googleMaps + openStreetMap)", () => {
  assert.equal(withPin.googleMaps, "https://www.google.com/maps/search/?api=1&query=40.377712,49.892034");
  assert.equal(withPin.openStreetMap, "https://www.openstreetmap.org/?mlat=40.377712&mlon=49.892034#map=17/40.377712/49.892034");
  assert.match(read("app/api/admin/order-coordinates/[orderId]/route.ts"), /googleMaps: links\.googleMaps, openStreetMap: links\.openStreetMap/);
});

test("address lines: city, street, extra, postal code with the existing labels; empty parts dropped", () => {
  assert.deepEqual(deliveryAddressParts({ line1: "Nizami 1", line2: "3-cü mərtəbə", city: "Bakı", postalCode: "AZ1000" }), [
    { label: "Şəhər", value: "Bakı" }, { label: "Ünvan", value: "Nizami 1" }, { label: "Əlavə məlumat", value: "3-cü mərtəbə" }, { label: "Poçt indeksi", value: "AZ1000" },
  ]);
  assert.deepEqual(deliveryAddressParts({ line1: "X", line2: "", city: "", postalCode: "" }), [{ label: "Ünvan", value: "X" }]);
  for (const label of ["Şəhər", "Əlavə məlumat", "Poçt indeksi"]) assert.ok(read("components/address-book-client.tsx").includes(label) || read("app/(customer)/(home)/page.tsx").includes(label), `${label} is existing wording`);
});

test("copy helper: modern clipboard first, legacy copy if refused, false when both fail or text is empty", async () => {
  const calls: string[] = [];
  assert.equal(await copyToClipboard("a", { writeText: async () => { calls.push("modern"); }, legacyCopy: () => { calls.push("legacy"); return true; } }), true);
  assert.deepEqual(calls, ["modern"]);
  assert.equal(await copyToClipboard("a", { writeText: async () => { throw new Error("denied"); }, legacyCopy: () => { calls.push("legacy"); return true; } }), true);
  assert.deepEqual(calls, ["modern", "legacy"]);
  assert.equal(await copyToClipboard("a", { legacyCopy: () => false }), false);
  assert.equal(await copyToClipboard("a", { legacyCopy: () => { throw new Error("x"); } }), false);
  assert.equal(await copyToClipboard("", { writeText: async () => undefined }), false);
  assert.equal(await copyToClipboard("a", {}), false);
});

test("avatar initials and the Apple-only row", () => {
  assert.equal(customerInitials("Leyla Məmmədova"), "LM");
  assert.equal(customerInitials("  şəhla   əliyeva qızı "), "ŞƏ");
  assert.equal(customerInitials("ilkin"), "İ", "Azerbaijani dotted capital I");
  assert.equal(customerInitials(""), "?");
  assert.equal(isAppleMapsPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), true);
  assert.equal(isAppleMapsPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), true);
  assert.equal(isAppleMapsPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8)"), false);
  assert.equal(isAppleMapsPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), false);
});

test("order page: same privacy rules — own store (404 otherwise), no e-mail, pin and menu only while the seller may see them", () => {
  const page = read("app/vendor/[storeId]/orders/[storeOrderId]/page.tsx");
  assert.match(page, /where: \{ id: storeOrderId, storeId: access\.storeId \}/);
  assert.match(page, /if \(!order\) notFound\(\);/);
  assert.doesNotMatch(page, /email/);
  assert.match(page, /const pin = locationAccess \? deliveryView\.coordinates : null;/);
  assert.match(page, /\{dispatchLinks && <VendorDeliveryAddressMenu links=\{dispatchLinks\} \/>\}/);
  assert.match(page, /\{!locationAccess \? <p[^>]*>Sifariş bağlandığı üçün xəritə nöqtəsi və çatdırılma menyusu artıq göstərilmir\.<\/p> : !pin && <p[^>]*>Xəritə nöqtəsi yoxdur\.<\/p>\}/);
  assert.match(page, /\{pin&&<section className=\{panel\}>/);
  assert.match(page, /value=\{formatCoordinates\(pin\)\}/, "coordinates copy only inside the pin section");
});

test("new visible words: only the pending texts, in one place", () => {
  assert.deepEqual(SELLER_CUSTOMER_CARD_TEXT, { copyPhone: "Nömrəni kopyala", phoneCopied: "Nömrə kopyalandı.", copyCoordinates: "Koordinatları kopyala", coordinatesCopied: "Koordinatlar kopyalandı.", appleMaps: "Apple Maps", yandexMaps: "Yandex Maps" });
});
