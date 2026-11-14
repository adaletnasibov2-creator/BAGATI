/**
 * Where the seller's "Bolt" menu item goes after copying the address. Bolt publishes no verified public deep link,
 * and an Android intent that opens the app by package name is not documented by Chrome (only BROWSABLE activities can
 * be opened from a browser), so the item opens the official store listing, which offers "Open" when Bolt is installed.
 *
 * Verified 2026-11-15 on the official pages:
 *   Google Play: https://play.google.com/store/apps/details?id=ee.mtakso.client -> "Bolt: Request a Ride"
 *   App Store (az): https://apps.apple.com/az/app/bolt-request-a-ride/id675033630 -> "Bolt: Request a Ride", BOLT TECHNOLOGY OU
 *
 * Client-only: the platform comes from the browser (navigator), never from the server.
 */
export const BOLT_ANDROID_PACKAGE = "ee.mtakso.client";
export const BOLT_PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${BOLT_ANDROID_PACKAGE}`;
export const BOLT_APP_STORE_URL = "https://apps.apple.com/az/app/id675033630";
export const BOLT_WEB_URL = "https://bolt.eu/";

export type ClientPlatform = "android" | "ios" | "desktop";

/** iPadOS 13+ reports itself as a Mac; a touch-capable "Macintosh" is treated as iOS. */
export function detectClientPlatform(userAgent: string, maxTouchPoints = 0): ClientPlatform {
  if (/Android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) return "ios";
  return "desktop";
}

export function boltOpenLink(platform: ClientPlatform): { href: string; label: string } {
  if (platform === "android") return { href: BOLT_PLAY_STORE_URL, label: "Google Play" };
  if (platform === "ios") return { href: BOLT_APP_STORE_URL, label: "App Store" };
  return { href: BOLT_WEB_URL, label: "bolt.eu" };
}
