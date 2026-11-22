/**
 * Checkout address-form defaults (SIGNUP-EASY-1 R4/R5). Pure; used by components/checkout-form.tsx and unit-tested.
 */
type CityOption = { id: string; name: string };
type SavedAddress = { cityId: string; isDefault: boolean };

const isBaku = (name: string) => name.trim().normalize("NFC").toLocaleLowerCase("az-AZ") === "bakı";

/** City preselected in the new-address form: the default address's city, else "Bakı", else the first active city. */
export function defaultCheckoutCityId(addresses: readonly SavedAddress[], cities: readonly CityOption[]): string {
  const defaultCity = addresses.find((address) => address.isDefault)?.cityId;
  if (defaultCity && cities.some((city) => city.id === defaultCity)) return defaultCity;
  return cities.find((city) => isBaku(city.name))?.id ?? cities[0]?.id ?? "";
}

/** The new-address form opens by itself when the customer has no saved address (one click less on the first order). */
export function addressFormOpenInitially(addresses: readonly unknown[]): boolean {
  return addresses.length === 0;
}
