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
  assert.equal(links.uber, "https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=40.4093&dropoff[longitude]=49.8671&dropoff[nickname]=Sifari%C5%9F%20%2334567890");
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
