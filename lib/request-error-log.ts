/**
 * One structured server log line per server-side render or route error (SCALE-FIX-1 A4), written from
 * instrumentation.ts (Next's onRequestError hook). The error page shows the same digest ("Xəta kodu"), so a report from a
 * visitor can be matched to this line. Next still logs the full error itself; this line adds the Prisma code (P2024 pool
 * timeout, P2028 transaction timeout, ...) so pool problems can be counted. It never contains the error message (it can
 * hold SQL or data) or the query string (search terms).
 */
export type RequestErrorRequest = { path: string; method: string };
export type RequestErrorContext = { routerKind?: string; routePath?: string; routeType?: string; renderSource?: string };

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || !(key in value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.length <= 200 ? field : undefined;
}

export function requestErrorLogLine(error: unknown, request: RequestErrorRequest, context: RequestErrorContext): string {
  const path = request.path.split("?")[0].slice(0, 300);
  return JSON.stringify({
    event: "request_error",
    digest: stringField(error, "digest"),
    code: stringField(error, "code"),
    name: error instanceof Error ? error.name : typeof error,
    method: request.method,
    path,
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
  });
}
