import type { Coordinates } from "@/lib/map-location";
import { normalizeDeliveryCoordinates } from "@/lib/delivery-location";

type AddressSource = {
  recipientName:string; phone:string; line1:string; line2:string|null;
  postalCode:string|null; latitude:number|null; longitude:number|null;
  city:{name:string};
};

/**
 * Copies fulfillment details into an immutable order snapshot. `null` explicitly clears a saved pin; `undefined` reuses it.
 * Only a usable pin (finite, inside Azerbaijan) is copied; anything else leaves the snapshot without coordinates.
 */
export function createOrderAddressSnapshot(address: AddressSource, selectedCoordinates?: Coordinates|null) {
  const coordinates = selectedCoordinates === undefined
    ? normalizeDeliveryCoordinates(address.latitude, address.longitude)
    : selectedCoordinates && normalizeDeliveryCoordinates(selectedCoordinates.latitude, selectedCoordinates.longitude);
  return {
    recipientName:address.recipientName, phone:address.phone, line1:address.line1,
    line2:address.line2, postalCode:address.postalCode, city:address.city.name,
    ...(coordinates ? {latitude:coordinates.latitude,longitude:coordinates.longitude} : {}),
  };
}
