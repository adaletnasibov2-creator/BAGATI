import { isIP } from "node:net";

/** Enable only when the origin accepts traffic solely through Cloudflare and its edge overwrites this header. */
export function trustedCloudflareClientIp(headers: Headers, trustedProxy = process.env.BAGATI_TRUST_CLOUDFLARE_IP === "true") {
  if (!trustedProxy) return null;
  const value = headers.get("cf-connecting-ip")?.trim();
  if (!value || value.includes(",") || !isIP(value)) return null;
  if (isIP(value) === 4) return value;
  return new URL(`http://[${value}]/`).hostname.slice(1, -1);
}
