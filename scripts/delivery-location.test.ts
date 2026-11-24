import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDispatchLinks, deliveryAddressText, isInsideAzerbaijan, maskCoordinates, normalizeDeliveryCoordinates,
  readAddressSnapshot, readOrderCoordinates, roundCoordinate,
} from "../lib/delivery-location";

test("Azerbaijan box: Baku, Ganja, Lankaran, Nakhchivan and Neft Daşları are inside; neighbours are outside", () => {
  for (const [latitude, longitude] of [[40.4093, 49.8671], [40.6828, 46.3606], [38.7543, 48.8506], [39.2089, 45.4122], [40.2246, 50.8297]]) {
    assert.equal(isInsideAzerbaijan({ latitude, longitude }), true, `${latitude},${longitude}`);
  }
  // A box, not a border: it keeps out pins from other countries' capitals and the wrong hemisphere.
  for (const [latitude, longitude] of [[41.7151, 44.6], [43.0, 47.0], [38.0, 48.0], [35.6892, 51.389], [40.1792, 44.4991], [0, 0], [51.5, -0.12]]) {
    assert.equal(isInsideAzerbaijan({ latitude, longitude }), false, `${latitude},${longitude}`);
  }
});

test("normalize: finite numbers inside the box, rounded to 6 decimals; everything else is null", () => {
  assert.deepEqual(normalizeDeliveryCoordinates(40.409312345678, 49.867098765432), { latitude: 40.409312, longitude: 49.867099 });
  assert.equal(roundCoordinate(49.1234565), 49.123457);
  for (const [lat, lng] of [[Number.NaN, 49.8], [40.4, Number.POSITIVE_INFINITY], ["40.4", 49.8], [40.4, null], [null, null], [91, 49], [51.5, -0.12]] as const) {
    assert.equal(normalizeDeliveryCoordinates(lat, lng), null, `${String(lat)},${String(lng)}`);
  }
});

test("checkout pin: never fails; bad, half-filled or foreign pins become 'no pin' (dropped)", () => {
  assert.deepEqual(readOrderCoordinates({ addressId: "a" }), { selected: undefined, dropped: false }, "keys absent: saved pin");
  assert.deepEqual(readOrderCoordinates({ addressId: "a", latitude: null, longitude: null }), { selected: null, dropped: false }, "text-only path");
  assert.deepEqual(readOrderCoordinates({ latitude: 40.4093, longitude: 49.8671 }), { selected: { latitude: 40.4093, longitude: 49.8671 }, dropped: false });
  for (const body of [{ latitude: 40.4, longitude: null }, { latitude: 40.4 }, { latitude: 91, longitude: 200 }, { latitude: 51.5, longitude: -0.12 }, { latitude: "40.4", longitude: "49.8" }, { latitude: {}, longitude: [] }]) {
    assert.deepEqual(readOrderCoordinates(body), { selected: null, dropped: true }, JSON.stringify(body));
  }
  assert.deepEqual(readOrderCoordinates(null), { selected: undefined, dropped: false });
  assert.deepEqual(readOrderCoordinates([1, 2]), { selected: undefined, dropped: false });
});

test("snapshot view: text fields, a valid pin, and old/bad pins read as no pin", () => {
  const view = readAddressSnapshot({ recipientName: "Ad Soyad", phone: "+994", line1: "Nizami 1", line2: "2-ci giriş, 5-ci mərtəbə", city: "Bakı", postalCode: "AZ1000", latitude: 40.4093, longitude: 49.8671 });
  assert.deepEqual(view.coordinates, { latitude: 40.4093, longitude: 49.8671 });
  assert.equal(deliveryAddressText(view), "Nizami 1, 2-ci giriş, 5-ci mərtəbə, Bakı, AZ1000");
  assert.equal(readAddressSnapshot({ line1: "X", latitude: 0, longitude: 0 }).coordinates, null);
  assert.equal(readAddressSnapshot("not an object").line1, "");
  assert.equal(maskCoordinates({ latitude: 40.4093, longitude: 49.8671 }), "40.4•••, 49.9•••");
});

test("dispatch links: exact Google, OpenStreetMap and Uber URLs; no name or phone anywhere", () => {
  const address = readAddressSnapshot({ recipientName: "Gizli Ad", phone: "+994501112233", line1: "Nizami küç. 1", line2: "", city: "Bakı", latitude: 40.4093, longitude: 49.8671 });
  const links = buildDispatchLinks(address, "cmabcdef1234567890");
  assert.equal(links.googleMaps, "https://www.google.com/maps/search/?api=1&query=40.4093,49.8671");
  assert.equal(links.openStreetMap, "https://www.openstreetmap.org/?mlat=40.4093&mlon=49.8671#map=17/40.4093/49.8671");
  // SELLER-CUSTOMER-CARD-1: the documented universal link (m.uber.com/looking, drop[0] = JSON); the old /ul/ path is not in Uber's docs.
  assert.equal(links.uber, `https://m.uber.com/looking?drop%5B0%5D=${encodeURIComponent(JSON.stringify({ latitude: 40.4093, longitude: 49.8671, addressLine1: "Sifariş #34567890" }))}`);
  assert.equal(links.copyText, "Nizami küç. 1, Bakı\n40.409300, 49.867100\nhttps://www.google.com/maps/search/?api=1&query=40.4093,49.8671");
  for (const value of Object.values(links)) assert.doesNotMatch(String(value), /Gizli|501112233/);
});

test("dispatch links without a pin: text search, no Uber link, copy text is the address only", () => {
  const links = buildDispatchLinks(readAddressSnapshot({ line1: "Nizami küç. 1 & 2", city: "Bakı" }), "order-1");
  assert.equal(links.googleMaps, "https://www.google.com/maps/search/?api=1&query=Nizami%20k%C3%BC%C3%A7.%201%20%26%202%2C%20Bak%C4%B1");
  assert.equal(links.openStreetMap, "https://www.openstreetmap.org/search?query=Nizami%20k%C3%BC%C3%A7.%201%20%26%202%2C%20Bak%C4%B1");
  assert.equal(links.uber, null);
  assert.equal(links.copyText, "Nizami küç. 1 & 2, Bakı");
});

test("seller access: open orders yes; 7 days after the shipment's delivery time; cancelled/returned at once", async () => {
  const { sellerCanSeeDeliveryLocation } = await import("../lib/delivery-location");
  const now = new Date("2026-11-14T12:00:00Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const see = (status: string, shipmentStatus: string | null, deliveredAt: Date | null = null) => sellerCanSeeDeliveryLocation({ status, shipmentStatus, deliveredAt }, now);
  for (const status of ["NEW", "CONFIRMED", "PREPARING", "READY", "HANDED_TO_COURIER", "SHIPPED"]) assert.equal(see(status, null), true, status);
  assert.equal(see("HANDED_TO_COURIER", "OUT_FOR_DELIVERY"), true);
  assert.equal(see("HANDED_TO_COURIER", "DELIVERY_FAILED"), true, "a failed attempt still needs the address");
  assert.equal(see("HANDED_TO_COURIER", "DELIVERED", daysAgo(6.9)), true);
  assert.equal(see("HANDED_TO_COURIER", "DELIVERED", daysAgo(7)), true, "exactly 7 days");
  assert.equal(see("DELIVERED", "DELIVERED", daysAgo(7.01)), false);
  assert.equal(see("HANDED_TO_COURIER", "DELIVERED", null), false, "delivered without a time");
  assert.equal(see("DELIVERED", null), false, "order delivered, shipment never marked: no time");
  assert.equal(see("DELIVERED", "OUT_FOR_DELIVERY"), false);
  assert.equal(see("CANCELLED", null), false);
  assert.equal(see("CANCELLED", "OUT_FOR_DELIVERY"), false);
  assert.equal(see("RETURNED", "DELIVERED", daysAgo(1)), false);
  assert.equal(see("HANDED_TO_COURIER", "RETURNED"), false);
});

test("dispatch links: Waze (documented ll + navigate=yes) and WhatsApp share text, URL-encoded", async () => {
  const { buildDispatchLinks, readAddressSnapshot } = await import("../lib/delivery-location");
  const withPin = buildDispatchLinks(readAddressSnapshot({ recipientName: "Gizli Ad", phone: "+994501112233", line1: "Nizami küç. 1 & 2", city: "Bakı", latitude: 40.4093, longitude: 49.8671 }), "order-1");
  assert.equal(withPin.waze, "https://waze.com/ul?ll=40.4093,49.8671&navigate=yes");
  assert.equal(withPin.whatsapp, `https://wa.me/?text=${encodeURIComponent("Nizami küç. 1 & 2, Bakı\nhttps://www.google.com/maps/search/?api=1&query=40.4093,49.8671")}`);
  assert.equal(new URL(withPin.whatsapp).searchParams.get("text"), "Nizami küç. 1 & 2, Bakı\nhttps://www.google.com/maps/search/?api=1&query=40.4093,49.8671");
  assert.doesNotMatch(withPin.whatsapp + withPin.waze, /Gizli|501112233/);
  const noPin = buildDispatchLinks(readAddressSnapshot({ line1: "Nizami küç. 1", city: "Bakı" }), "order-1");
  assert.equal(noPin.waze, null, "no pin: no Waze");
  assert.equal(new URL(noPin.whatsapp).searchParams.get("text"), "Nizami küç. 1, Bakı", "no pin: address text only, no location link");
  // An old/foreign pin reads as no pin, so it never reaches Waze or WhatsApp either.
  const foreign = buildDispatchLinks(readAddressSnapshot({ line1: "X", city: "Bakı", latitude: 51.5, longitude: -0.12 }), "o");
  assert.equal(foreign.waze, null);
  assert.doesNotMatch(foreign.whatsapp, /google\.com|51\.5/);
});

test("Bolt: verified store links per platform, detected from the browser only", async () => {
  const { boltOpenLink, detectClientPlatform, BOLT_PLAY_STORE_URL, BOLT_APP_STORE_URL } = await import("../lib/bolt-app");
  assert.equal(BOLT_PLAY_STORE_URL, "https://play.google.com/store/apps/details?id=ee.mtakso.client");
  assert.equal(BOLT_APP_STORE_URL, "https://apps.apple.com/az/app/id675033630");
  assert.equal(detectClientPlatform("Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36"), "android");
  assert.equal(detectClientPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"), "ios");
  assert.equal(detectClientPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15", 5), "ios", "iPadOS");
  assert.equal(detectClientPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15", 0), "desktop");
  assert.equal(detectClientPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0"), "desktop");
  assert.deepEqual(boltOpenLink("android"), { href: BOLT_PLAY_STORE_URL, label: "Google Play" });
  assert.deepEqual(boltOpenLink("ios"), { href: BOLT_APP_STORE_URL, label: "App Store" });
  assert.deepEqual(boltOpenLink("desktop"), { href: "https://bolt.eu/", label: "bolt.eu" });
});
