/**
 * Next.js server start hook. Starts the in-process email worker (lib/email-worker-runtime.ts) only in the Node.js
 * runtime and only when EMAIL_WORKER_ENABLED=true. Default off, so `next build`, `next dev` and tests never send.
 * The nested `if` keeps the worker (Prisma, nodemailer) out of the Edge bundle.
 */
export async function register() {
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
