export const SECURITY_EVENT_SOURCES = ["APPLICATION", "CLOUDFLARE", "APACHE_MODSECURITY"] as const;
export const SECURITY_EVENT_TYPES = [
  "LOGIN_FAILURE",
  "RATE_LIMIT_VIOLATION",
  "SUSPICIOUS_PATH",
  "ABUSIVE_API",
  "WAF_EVENT",
  "MODSECURITY_EVENT",
] as const;
export const SECURITY_EVENT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const SECURITY_EVENT_ACTIONS = ["OBSERVED", "DENIED", "CHALLENGED", "BLOCKED", "ALLOWED"] as const;
export const SECURITY_EVENT_WINDOWS = ["1h", "24h", "7d", "30d"] as const;

export type SecurityEventWindow = (typeof SECURITY_EVENT_WINDOWS)[number];

const SECURITY_EVENT_WINDOW_MILLISECONDS: Record<(typeof SECURITY_EVENT_WINDOWS)[number], number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const SECURITY_EVENT_WINDOW_BUCKETS: Record<SecurityEventWindow, number> = {
  "1h": 12,
  "24h": 24,
  "7d": 7,
  "30d": 15,
};

export function securityEventWindowStart(
  window: SecurityEventWindow,
  now: Date,
) {
  return new Date(now.getTime() - SECURITY_EVENT_WINDOW_MILLISECONDS[window]);
}

export function securityEventWindowBucketCount(window: SecurityEventWindow) {
  return SECURITY_EVENT_WINDOW_BUCKETS[window];
}
