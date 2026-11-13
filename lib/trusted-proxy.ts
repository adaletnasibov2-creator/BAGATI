import { isIP } from "node:net";

/**
 * One header value → a canonical IP, or null. Rejects lists, ports and anything that is not an IP.
 * IPv4-mapped IPv6 ("::ffff:203.0.113.5") becomes the IPv4 address; IPv6 is lower-cased and compressed.
 */
export function canonicalHeaderIp(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text || text.includes(",")) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(text);
  if (mapped && isIP(mapped[1]) === 4) return mapped[1];
  const family = isIP(text);
  if (family === 4) return text;
  if (family === 6) return new URL(`http://[${text}]/`).hostname.slice(1, -1);
  return null;
}

/**
 * Defence in depth: on the production edge Cloudflare sets CF-Connecting-IP and the Cloudways Nginx overwrites
 * X-Real-IP with the real client address, so both name the same client. If both are present and differ (after
 * normalisation, an invalid X-Real-IP counts as different), something in front of the app is not behaving as
 * expected, and neither header is trusted for this request.
 */
export function clientIpHeaderMismatch(headers: Headers): boolean {
  const cf = headers.get("cf-connecting-ip");
  const real = headers.get("x-real-ip");
  if (cf === null || real === null) return false;
  const cfIp = canonicalHeaderIp(cf);
  const realIp = canonicalHeaderIp(real);
  return !cfIp || !realIp || cfIp !== realIp;
}

/**
 * Client IP for per-IP limits and security events. Enabled only with BAGATI_TRUST_CLOUDFLARE_IP=true (the origin
 * accepts traffic through Cloudflare and the edge overwrites the header). Returns null (unknown) when the header is
 * missing or invalid, or when CF-Connecting-IP and X-Real-IP disagree (see clientIpHeaderMismatch).
 */
export function trustedCloudflareClientIp(headers: Headers, trustedProxy = process.env.BAGATI_TRUST_CLOUDFLARE_IP === "true") {
  if (!trustedProxy) return null;
  const value = canonicalHeaderIp(headers.get("cf-connecting-ip"));
  if (!value) return null;
  if (clientIpHeaderMismatch(headers)) return null;
  return value;
}
