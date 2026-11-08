import type { Coordinates } from "@/lib/map-location";

type AddressSource = {
  recipientName:string; phone:string; line1:string; line2:string|null;
  postalCode:string|null; latitude:number|null; longitude:number|null;
  city:{name:string};
};

/** Copies fulfillment details into an immutable order snapshot. `null` explicitly clears a saved pin; `undefined` reuses it. */
export function createOrderAddressSnapshot(address: AddressSource, selectedCoordinates?: Coordinates|null) {
  const coordinates = selectedCoordinates === undefined
    ? address.latitude != null && address.longitude != null ? {latitude:address.latitude,longitude:address.longitude} : null
    : selectedCoordinates;
  return {
    recipientName:address.recipientName, phone:address.phone, line1:address.line1,
    line2:address.line2, postalCode:address.postalCode, city:address.city.name,
    ...(coordinates ? {latitude:coordinates.latitude,longitude:coordinates.longitude} : {}),
  };
}
