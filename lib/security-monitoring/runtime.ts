/**
 * API route wrapper for Security Center telemetry. Server-only.
 */
import { noteClientIpHeaderMismatch } from "@/lib/security-events";
import { securityTelemetry } from "@/lib/security-monitoring/instance";


/**
 * Wraps an API route handler: records the response status and duration for `group`, and counts a
 * CF-Connecting-IP / X-Real-IP mismatch. Recording happens after the handler finished and never awaits; a thrown
 * error is counted as 500 and rethrown unchanged.
 */
export function withSecurityTelemetry<A extends unknown[], R extends Response | undefined>(group: string, handler: (...args: A) => Promise<R> | R): (...args: A) => Promise<R> {
  return async (...args: A) => {
    const started = performance.now();
    let status = 500;
    try {
      const response = await handler(...args);
      status = response?.status ?? 200;
      return response;
    } finally {
      try {
        securityTelemetry.recordResponse(group, status, performance.now() - started);
        const request = args[0];
        if (request instanceof Request && noteClientIpHeaderMismatch(request, new URL(request.url).pathname)) securityTelemetry.recordIpMismatch(group);
      } catch { /* telemetry never affects the response */ }
    }
  };
}
