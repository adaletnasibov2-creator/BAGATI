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
  googleMaps: string;
  openStreetMap: string;
  /** Only with a pin: Uber needs a drop-off point. Pickup is the seller's current location. */
  uber: string | null;
  /** Clipboard text for Bolt (no verified public deep link) and for "Ünvanı kopyala". */
  copyText: string;
};

/** Seller dispatch links for one order. Text is URL-encoded; the nickname is the order number, never the customer's name. */
export function buildDispatchLinks(address: DeliveryAddressView, orderRef: string): DispatchLinks {
  const addressText = deliveryAddressText(address);
  const point = address.coordinates;
  const query = point ? `${point.latitude},${point.longitude}` : encodeURIComponent(addressText);
  const googleMaps = `https://www.google.com/maps/search/?api=1&query=${query}`;
  const openStreetMap = point
    ? `https://www.openstreetmap.org/?mlat=${point.latitude}&mlon=${point.longitude}#map=17/${point.latitude}/${point.longitude}`
    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(addressText)}`;
  const nickname = encodeURIComponent(`Sifariş #${orderRef.slice(-8).toUpperCase()}`);
  const uber = point
    ? `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=${point.latitude}&dropoff[longitude]=${point.longitude}&dropoff[nickname]=${nickname}`
    : null;
  const copyText = [addressText, point ? formatCoordinates(point) : "", point ? googleMaps : ""].filter(Boolean).join("\n");
  return { googleMaps, openStreetMap, uber, copyText };
}
