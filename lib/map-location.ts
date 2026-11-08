export type Coordinates = { latitude: number; longitude: number };

export function isValidCoordinates(value: Coordinates): boolean {
  return Number.isFinite(value.latitude) && Number.isFinite(value.longitude)
    && value.latitude >= -90 && value.latitude <= 90
    && value.longitude >= -180 && value.longitude <= 180;
}
