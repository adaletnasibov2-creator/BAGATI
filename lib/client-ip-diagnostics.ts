/**
 * Read-only diagnostics for how the app sees the client IP on the admin's own request. Pure; unit-tested.
 * Only masked values leave this module (203.0.*.* style), never a full address.
 */
import { isIP } from "node:net";
import { maskIpAddress } from "@/lib/admin-system-status";
import { trustedCloudflareClientIp } from "@/lib/trusted-proxy";

export const CLIENT_IP_HEADERS = ["cf-connecting-ip", "true-client-ip", "x-forwarded-for", "x-real-ip", "forwarded"] as const;

/** Published at https://www.cloudflare.com/ips-v4 and /ips-v6 (fetched 2026-11-13). Cloudflare changes these rarely. */
export const CLOUDFLARE_IPV4_RANGES = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
  "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
] as const;
export const CLOUDFLARE_IPV6_RANGES = [
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
] as const;

function ipv4ToBigInt(ip: string): bigint {
  return ip.split(".").reduce((value, part) => (value << BigInt(8)) | BigInt(Number(part)), BigInt(0));
}

function ipv6ToBigInt(ip: string): bigint {
  let address = ip.toLowerCase();
  const embedded = /(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (embedded) {
    const v4 = ipv4ToBigInt(embedded[1]);
    address = address.slice(0, -embedded[1].length) + `${(v4 >> BigInt(16)).toString(16)}:${(v4 & BigInt(0xffff)).toString(16)}`;
  }
  const [head, tail] = address.includes("::") ? address.split("::") : [address, null];
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const groups = tail === null ? headParts : [...headParts, ...new Array(8 - headParts.length - tailParts.length).fill("0"), ...tailParts];
  return groups.reduce((value, group) => (value << BigInt(16)) | BigInt(parseInt(group || "0", 16)), BigInt(0));
}

function inCidr(ip: string, cidr: string): boolean {
  const [base, bitsText] = cidr.split("/");
  const bits = BigInt(Number(bitsText));
  const family = isIP(ip);
  if (family !== isIP(base)) return false;
  const width = family === 4 ? BigInt(32) : BigInt(128);
  const toInt = family === 4 ? ipv4ToBigInt : ipv6ToBigInt;
  const shift = width - bits;
  return (toInt(ip) >> shift) === (toInt(base) >> shift);
}

export function isCloudflareIp(value: string | null | undefined): boolean {
  const ip = normalizeIp(value);
  if (!ip) return false;
  const ranges: readonly string[] = isIP(ip) === 4 ? CLOUDFLARE_IPV4_RANGES : CLOUDFLARE_IPV6_RANGES;
  return ranges.some((range) => inCidr(ip, range));
}

/** Strips quotes, IPv6 brackets and a port; returns null unless the result is an IP address. */
export function normalizeIp(value: string | null | undefined): string | null {
  let candidate = (value ?? "").trim().replace(/^"|"$/g, "");
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(candidate);
  if (bracketed) candidate = bracketed[1];
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(candidate)) candidate = candidate.replace(/:\d+$/, "");
  return isIP(candidate) ? candidate : null;
}

export function parseForwardedFor(value: string | null): (string | null)[] {
  if (!value) return [];
  return value.split(",").slice(0, 20).map((entry) => normalizeIp(entry));
}

/** RFC 7239 `Forwarded: for=1.2.3.4;proto=https, for="[2001:db8::1]"` → the for= addresses. */
export function parseForwardedHeader(value: string | null): (string | null)[] {
  if (!value) return [];
  return value.split(",").slice(0, 20).map((element) => {
    const match = /(?:^|;)\s*for=("[^"]*"|[^;,\s]*)/i.exec(element);
    return match ? normalizeIp(match[1]) : null;
  });
}

const masked = (ip: string | null) => (ip ? maskIpAddress(ip) : "yanlış dəyər");

export type ClientIpDiagnostics = {
  flagEnabled: boolean;
  headers: { name: string; present: boolean; values: string[] }[];
  forwardedChain: { masked: string; cloudflare: boolean }[];
  rightmostHopCloudflare: boolean | null;
  cfConnectingIpMatchesLeftmostXff: boolean | null;
  /** Route handlers in Next.js 15 cannot read the TCP peer; Next only copies it into X-Forwarded-For when no proxy set that header. */
  socketAddressAvailable: false;
  ipWithFlagOff: null;
  ipWithFlagOn: string | null;
};

export function clientIpDiagnostics(headers: Headers, flagEnabled: boolean): ClientIpDiagnostics {
  const read = (name: string) => headers.get(name);
  const xff = parseForwardedFor(read("x-forwarded-for"));
  const values: Record<string, (string | null)[]> = {
    "cf-connecting-ip": read("cf-connecting-ip") === null ? [] : [normalizeIp(read("cf-connecting-ip"))],
    "true-client-ip": read("true-client-ip") === null ? [] : [normalizeIp(read("true-client-ip"))],
    "x-forwarded-for": xff,
    "x-real-ip": read("x-real-ip") === null ? [] : [normalizeIp(read("x-real-ip"))],
    forwarded: parseForwardedHeader(read("forwarded")),
  };
  const cf = normalizeIp(read("cf-connecting-ip"));
  const rightmost = xff.length ? xff[xff.length - 1] : undefined;
  const flagOn = trustedCloudflareClientIp(headers, true);
  return {
    flagEnabled,
    headers: CLIENT_IP_HEADERS.map((name) => ({ name, present: read(name) !== null, values: values[name].map(masked) })),
    forwardedChain: xff.map((ip) => ({ masked: masked(ip), cloudflare: isCloudflareIp(ip) })),
    rightmostHopCloudflare: rightmost === undefined ? null : isCloudflareIp(rightmost),
    cfConnectingIpMatchesLeftmostXff: cf && xff.length ? xff[0] === cf : null,
    socketAddressAvailable: false,
    ipWithFlagOff: null,
    ipWithFlagOn: flagOn ? maskIpAddress(flagOn) : null,
  };
}
