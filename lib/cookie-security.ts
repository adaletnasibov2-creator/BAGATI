import { allowsInsecureHttpHost } from "./csrf";

/**
 * Whether an auth cookie should carry the `Secure` attribute.
 *
 * Production cookies are Secure, with one exception: the browser itself reports (via
 * Origin, else Referer) that the page is plain HTTP on a loopback/private-LAN/machine-name
 * host — the same hosts the CSRF policy already accepts over HTTP. Browsers silently drop
 * Secure cookies set from such pages, which made login "succeed" and then bounce back to the
 * login page on phones testing http://192.168.x.x. Any HTTPS page, and any request without a
 * browser origin, keeps `Secure`. The decision never relies on the Host header alone, so a
 * proxy that rewrites Host cannot downgrade cookies for the public HTTPS site.
 */
export function cookieSecureFor(input: { production: boolean; origin?: string | null; referer?: string | null }): boolean {
  if (!input.production) return false;
  const source = input.origin && input.origin !== "null" ? input.origin : input.referer;
  if (!source) return true;
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return true;
  }
  if (url.protocol !== "http:") return true;
  return !allowsInsecureHttpHost(url.host, true);
}

/** Reads the current request's Origin/Referer. Outside a request (scripts/tests) it keeps the production default. */
export async function requestCookieSecure(): Promise<boolean> {
  const production = process.env.NODE_ENV === "production";
  try {
    const { headers } = await import("next/headers");
    const list = await headers();
    return cookieSecureFor({ production, origin: list.get("origin"), referer: list.get("referer") });
  } catch {
    return production;
  }
}
