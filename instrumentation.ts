/**
 * Next.js server start hook. Starts the in-process email worker (lib/email-worker-runtime.ts) only in the Node.js
 * runtime and only when EMAIL_WORKER_ENABLED=true. Default off, so `next build`, `next dev` and tests never send.
 * The nested `if` keeps the worker (Prisma, nodemailer) out of the Edge bundle.
 */
export async function register() {
  // SCALE-FIX-4: one log line with the effective pool settings (A9, no secrets), and the unpaid-order expiry loop (B5),
  // which starts only when Epoint is configured (lib/order-expiry-runtime.ts) and is switched on in admin settings.
  // Nested `if`s for the same reason as below: nothing here may reach the Edge bundle.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      try {
        const { dbPoolLogLine } = await import("./lib/db-pool-info");
        console.info(dbPoolLogLine(process.env));
      } catch {
        console.error("db_pool log failed");
      }
      try {
        const { readEpointConfig } = await import("./lib/payments/epoint-config");
        if (readEpointConfig(process.env)) {
          const { startOrderExpiryLoop } = await import("./lib/order-expiry-runtime");
          startOrderExpiryLoop(process.env);
        }
      } catch {
        console.error("Order expiry loop did not start (WORKER_FAILED).");
      }
    }
  }
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.EMAIL_WORKER_ENABLED !== "true" || process.env.NEXT_PHASE === "phase-production-build") return;
    try {
      const { startInProcessEmailWorker } = await import("./lib/email-worker-runtime");
      startInProcessEmailWorker(process.env);
    } catch {
      console.error("Email outbox worker did not start (WORKER_FAILED).");
    }
  }
}

/**
 * Server-side error log (SCALE-FIX-1 A4): one structured line per render or route error, with the digest the error
 * page shows and the Prisma error code, never the message or query string (lib/request-error-log.ts). Logging only;
 * Next still logs the error itself and the error boundaries show the friendly page.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind?: string; routePath?: string; routeType?: string; renderSource?: string },
) {
  try {
    const { requestErrorLogLine } = await import("./lib/request-error-log");
    console.error(requestErrorLogLine(error, request, context));
  } catch {
    console.error("request_error log failed");
  }
}
