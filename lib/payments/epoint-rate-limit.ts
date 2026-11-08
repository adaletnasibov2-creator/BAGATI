import { trustedCloudflareClientIp } from "@/lib/trusted-proxy";

const buckets = new Map<string, { count: number; reset: number }>();

/** Process-local limit. It does not read or write the database. */
export function consumePaymentRateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const current = buckets.get(key);
  if (!current || current.reset <= now) {
    if (buckets.size > 5000) {
      for (const [stored, bucket] of buckets) if (bucket.reset <= now) buckets.delete(stored);
    }
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export function paymentClientKey(headers: Headers, trustedProxy?: boolean) {
  const ip = trustedCloudflareClientIp(headers, trustedProxy);
  return ip ? `trusted-ip:${ip}` : null;
}
