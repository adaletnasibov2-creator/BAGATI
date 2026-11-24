/**
 * Delivery location: coordinate sanity rules, the read-only view of an order's address snapshot and the seller's
 * dispatch links. Pure functions (no database, no Next.js), shared by the APIs, the pages and the tests.
 *
 * Privacy: coordinates are shown only to the order's store(s) and to admins. Nothing here logs, and dispatch links
 * carry coordinates, the address text and the order number only, never the customer's name or phone.
 */
import { isValidCoordinates, type Coordinates } from "@/lib/map-location";

/** Rough box around Azerbaijan (mainland, Nakhchivan, the Caspian coast and islands). A sanity check, not a border. */
export const AZERBAIJAN_BOUNDS = { minLatitude: 38.3, maxLatitude: 42.0, minLongitude: 44.7, maxLongitude: 50.9 } as const;

export const OUTSIDE_AZERBAIJAN_MESSAGE = "Seçilmiş nöqtə Azərbaycan ərazisindən kənardadır.";

export function isInsideAzerbaijan(value: Coordinates): boolean {
  return isValidCoordinates(value)
    && value.latitude >= AZERBAIJAN_BOUNDS.minLatitude && value.latitude <= AZERBAIJAN_BOUNDS.maxLatitude
    && value.longitude >= AZERBAIJAN_BOUNDS.minLongitude && value.longitude <= AZERBAIJAN_BOUNDS.maxLongitude;
}

/** 6 decimal places (about 0.1 m): more is noise from the device, not precision. */
export function roundCoordinate(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** A usable delivery pin (finite, inside Azerbaijan), rounded; anything else is null. */
export function normalizeDeliveryCoordinates(latitude: unknown, longitude: unknown): Coordinates | null {
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  const point = { latitude, longitude };
  if (!isInsideAzerbaijan(point)) return null;
  return { latitude: roundCoordinate(latitude), longitude: roundCoordinate(longitude) };
}

/**
 * Reads the optional pin of a checkout request. It never fails: a missing, half-filled, malformed or out-of-Azerbaijan
 * pin becomes "no pin" (`null`, `dropped: true`) so the order is created from the address text exactly as without a map.
 * `undefined` (both keys absent) keeps the old meaning "use the pin saved on the address".
 */
export function readOrderCoordinates(raw: unknown): { selected: Coordinates | null | undefined; dropped: boolean } {
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const hasLatitude = Object.prototype.hasOwnProperty.call(body, "latitude");
  const hasLongitude = Object.prototype.hasOwnProperty.call(body, "longitude");
  if (!hasLatitude && !hasLongitude) return { selected: undefined, dropped: false };
  if (body.latitude == null && body.longitude == null) return { selected: null, dropped: false };
  const selected = normalizeDeliveryCoordinates(body.latitude, body.longitude);
  return selected ? { selected, dropped: false } : { selected: null, dropped: true };
}

export type DeliveryAddressView = {
  recipientName: string; phone: string; line1: string; line2: string; postalCode: string; city: string;
  coordinates: Coordinates | null;
};

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

/** Safe read of `Order.addressSnapshot` (JSON). Old or bad pins (outside Azerbaijan, non-finite) read as no pin. */
export function readAddressSnapshot(snapshot: unknown): DeliveryAddressView {
  const value = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot as Record<string, unknown> : {};
  return {
    recipientName: text(value.recipientName), phone: text(value.phone), line1: text(value.line1), line2: text(value.line2),
    postalCode: text(value.postalCode), city: text(value.city),
    coordinates: normalizeDeliveryCoordinates(value.latitude, value.longitude),
  };
}

/** "line1, line2, city, postal code" (no name, no phone). */
export function deliveryAddressText(address: Pick<DeliveryAddressView, "line1" | "line2" | "city" | "postalCode">): string {
  return [address.line1, address.line2, address.city, address.postalCode].filter(Boolean).join(", ");
}

export function formatCoordinates(point: Coordinates): string {
  return `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`;
}

/** "40.4•••, 49.8•••": enough to see that a pin exists, not enough to find the door. */
export function maskCoordinates(point: Coordinates): string {
  const mask = (value: number) => `${value.toFixed(1)}•••`;
  return `${mask(point.latitude)}, ${mask(point.longitude)}`;
}

export type DispatchLinks = {
  /** Google Maps pin/search link (admin "Google Maps" link, WhatsApp share text and copy text). Unchanged. */
  googleMaps: string;
  /** Admin coordinates card only (the seller menu no longer offers OpenStreetMap). Unchanged. */
  openStreetMap: string;
  /**
   * SELLER-CUSTOMER-CARD-1: one link per app, built ONLY from formats in each app's official documentation
   * (sources and VERIFIED status: release-output/seller-customer-card-1-report.md and the comments below).
   * A pin is used when it exists, otherwise the address text. Never the customer's name or phone.
   */
  apps: DispatchAppLinks;
  /** Only with a pin: Uber's documented universal link needs drop-off coordinates. Same as `apps.uber`. */
  uber: string | null;
  /** Same as `apps.waze` (kept for existing callers). */
  waze: string | null;
  /** "Ünvanı göndər": wa.me with no number (the seller picks the chat), the address text and, with a pin, a Google Maps link. */
  whatsapp: string;
  /** Clipboard text for Bolt and the old "Ünvanı kopyala": address, coordinates and the Google Maps link. */
  copyText: string;
  /** "Ünvanı kopyala": the address text only (line1, line2, city, postal code). */
  addressText: string;
  /** "Koordinatları kopyala": "40.377712, 49.892034", or null without a pin. */
  coordinatesText: string | null;
};

export type DispatchAppLinks = {
  /** https://developers.google.com/maps/documentation/urls/get-started (Directions): /maps/dir/?api=1&destination=…&travelmode=driving */
  googleMaps: string;
  /** https://developers.google.com/waze/deeplinks: ?ll=LAT,LNG&navigate=yes with a pin; ?q=TEXT (search) without one. */
  waze: string;
  /** https://developer.apple.com/documentation/mapkit/unified-map-urls: /directions?destination=…&mode=driving (iOS 18.4+, macOS 15.4+). */
  appleMaps: string;
  /** https://yandex.com/dev/yandex-apps-launch-maps/doc/en/concepts/yandexmaps-web: ?pt=LON,LAT (longitude first) with a pin; ?text=TEXT without. */
  yandexMaps: string;
  /** https://developer.uber.com/docs/riders/ride-requests/tutorials/deep-links/introduction: m.uber.com/looking?drop[0]=<JSON>. Pin only. */
  uber: string | null;
};

/** Hosts a seller dispatch link may point to (tests assert every generated link stays on this list). */
export const DISPATCH_LINK_HOSTS = ["www.google.com", "waze.com", "maps.apple.com", "yandex.ru", "m.uber.com", "wa.me", "www.openstreetmap.org"] as const;

/** Seller dispatch links for one order. Text is URL-encoded; the Uber label is the order number, never the customer's name. */
export function buildDispatchLinks(address: DeliveryAddressView, orderRef: string): DispatchLinks {
  const addressText = deliveryAddressText(address);
  const point = address.coordinates;
  const query = point ? `${point.latitude},${point.longitude}` : encodeURIComponent(addressText);
  const googleMaps = `https://www.google.com/maps/search/?api=1&query=${query}`;
  const openStreetMap = point
    ? `https://www.openstreetmap.org/?mlat=${point.latitude}&mlon=${point.longitude}#map=17/${point.latitude}/${point.longitude}`
    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(addressText)}`;
  const encodedAddress = encodeURIComponent(addressText);
  // Google: "You must encode the comma as %2C"; Waze and Apple document a plain comma in their own examples.
  const destination = point ? `${point.latitude}%2C${point.longitude}` : encodedAddress;
  const label = `Sifariş #${orderRef.slice(-8).toUpperCase()}`;
  const uber = point
    ? `https://m.uber.com/looking?drop%5B0%5D=${encodeURIComponent(JSON.stringify({ latitude: point.latitude, longitude: point.longitude, addressLine1: label }))}`
    : null;
  const apps: DispatchAppLinks = {
    googleMaps: `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`,
    waze: point ? `https://waze.com/ul?ll=${point.latitude},${point.longitude}&navigate=yes` : `https://waze.com/ul?q=${encodedAddress}`,
    appleMaps: `https://maps.apple.com/directions?destination=${point ? `${point.latitude},${point.longitude}` : encodedAddress}&mode=driving`,
    yandexMaps: point ? `https://yandex.ru/maps/?pt=${point.longitude},${point.latitude}&z=17&l=map` : `https://yandex.ru/maps/?text=${encodedAddress}`,
    uber,
  };
  const whatsapp = `https://wa.me/?text=${encodeURIComponent([addressText, point ? googleMaps : ""].filter(Boolean).join("\n"))}`;
  const coordinatesText = point ? formatCoordinates(point) : null;
  const copyText = [addressText, coordinatesText ?? "", point ? googleMaps : ""].filter(Boolean).join("\n");
  return { googleMaps, openStreetMap, apps, uber, waze: point ? apps.waze : null, whatsapp, copyText, addressText, coordinatesText };
}

/** The address as separate lines for the seller's card: street (line1), extra (line2), city, postal code. Empty parts dropped. */
export function deliveryAddressParts(address: Pick<DeliveryAddressView, "line1" | "line2" | "city" | "postalCode">): { label: string; value: string }[] {
  return ([["Şəhər", address.city], ["Ünvan", address.line1], ["Əlavə məlumat", address.line2], ["Poçt indeksi", address.postalCode]] as const)
    .filter(([, value]) => Boolean(value)).map(([label, value]) => ({ label, value }));
}

/** How long the seller keeps the pin and the dispatch menu after the shipment is marked delivered. */
export const SELLER_LOCATION_DAYS_AFTER_DELIVERY = 7;

/**
 * Whether the store may still see the delivery pin and the dispatch menu (the address text stays visible).
 * The 7 days count from the shipment's "Çatdırıldı" time (`deliveredAt`). A cancelled or returned order, a returned
 * shipment, or an order marked delivered without a shipment time has no reliable closing time (no column records it),
 * so it is hidden at once. Admins always see the pin; this rule is for sellers only.
 */
export function sellerCanSeeDeliveryLocation(
  storeOrder: { status: string; shipmentStatus: string | null; deliveredAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (["CANCELLED", "RETURNED"].includes(storeOrder.status) || storeOrder.shipmentStatus === "RETURNED") return false;
  if (storeOrder.shipmentStatus === "DELIVERED") {
    if (!storeOrder.deliveredAt) return false;
    return now.getTime() - storeOrder.deliveredAt.getTime() <= SELLER_LOCATION_DAYS_AFTER_DELIVERY * 24 * 60 * 60 * 1000;
  }
  return storeOrder.status !== "DELIVERED";
}
