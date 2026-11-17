/**
 * Admin email tools on the "Email çatdırılması" page:
 *  - "Test e-poçtu göndər": one diagnostic email, ONLY to the signed-in admin's own address (no recipient input);
 *  - "Növbəni indi göndər": one outbox batch now, under the same advisory lock as the in-process worker.
 *
 * Both: same-origin check, ADMIN only, rate limited per admin, audited (outcome and counts only; no addresses,
 * payloads or provider text). Dependencies are injected so authorization and limits are unit-tested.
 */
import { NextResponse } from "next/server";
import { classifySmtpFailure, safeSmtpErrorMetadata } from "@/lib/email";
import { diagnoseEmailDeliveryFailure } from "@/lib/email-outbox-core";
import { workerFailureCode } from "@/lib/email-worker-loop";
import type { DrainNowResult } from "@/lib/email-worker-runtime";

export type AdminActor = { id: string; email: string };
export type AdminEmailAction = "test" | "drain";

export type AdminEmailActionDependencies = {
  csrfRejection: (request: Request) => Response | null;
  requireAdmin: () => Promise<AdminActor | null>;
  /** True when the admin may act now. Throws when the limiter itself is unavailable. */
  consumeRateLimit: (action: AdminEmailAction, adminId: string) => Promise<boolean>;
  audit: (entry: { actorId: string; action: string; metadata: Record<string, string | number | null> }) => Promise<void>;
};

const headers = { "Cache-Control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers });

async function guard(request: Request, action: AdminEmailAction, deps: AdminEmailActionDependencies): Promise<{ admin: AdminActor } | { response: Response }> {
  const crossSite = deps.csrfRejection(request);
  if (crossSite) return { response: crossSite };
  const admin = await deps.requireAdmin();
  if (!admin) return { response: json({ error: "İcazə yoxdur" }, 403) };
  let allowed: boolean;
  try {
    allowed = await deps.consumeRateLimit(action, admin.id);
  } catch {
    return { response: json({ error: "Limit yoxlaması hazırda mümkün deyil. Bir az sonra yenidən cəhd edin." }, 503) };
  }
  if (!allowed) return { response: json({ error: "Çox tez-tez cəhd edildi. Bir az sonra yenidən yoxlayın." }, 429) };
  return { admin };
}

async function safeAudit(deps: AdminEmailActionDependencies, entry: Parameters<AdminEmailActionDependencies["audit"]>[0]) {
  try {
    await deps.audit(entry);
  } catch (error) {
    console.error(`Admin email audit write failed (${workerFailureCode(error)}).`);
  }
}

const isSmtpMissing = (error: unknown) => error instanceof Error && error.name === "SmtpConfigurationError";

/** The request body is ignored on purpose: the recipient is always the admin's own account address. */
export async function handleAdminTestEmail(
  request: Request,
  deps: AdminEmailActionDependencies & { sendDiagnostic: (to: string) => Promise<void> },
): Promise<Response> {
  const checked = await guard(request, "test", deps);
  if ("response" in checked) return checked.response;
  const { admin } = checked;
  try {
    await deps.sendDiagnostic(admin.email);
  } catch (error) {
    if (isSmtpMissing(error)) {
      await safeAudit(deps, { actorId: admin.id, action: "EMAIL_TEST_SEND", metadata: { outcome: "smtp_not_configured", category: null, code: "SMTP_NOT_CONFIGURED" } });
      return json({ error: "SMTP konfiqurasiya edilməyib: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM." }, 503);
    }
    const category = classifySmtpFailure(safeSmtpErrorMetadata(error));
    const code = diagnoseEmailDeliveryFailure(error).diagnosticCode;
    await safeAudit(deps, { actorId: admin.id, action: "EMAIL_TEST_SEND", metadata: { outcome: "failed", category, code } });
    return json({ error: `Sınaq məktubu göndərilmədi (${category}, ${code}).`, category, code }, 502);
  }
  await safeAudit(deps, { actorId: admin.id, action: "EMAIL_TEST_SEND", metadata: { outcome: "accepted", category: null, code: null } });
  return json({ ok: true, message: "Sınaq məktubu öz admin ünvanınıza göndərildi: provayder qəbul etdi. Gələnlər və spam qovluğunu yoxlayın." });
}

export async function handleAdminOutboxDrain(
  request: Request,
  deps: AdminEmailActionDependencies & { drain: () => Promise<DrainNowResult> },
): Promise<Response> {
  const checked = await guard(request, "drain", deps);
  if ("response" in checked) return checked.response;
  const { admin } = checked;
  let outcome: DrainNowResult;
  try {
    outcome = await deps.drain();
  } catch (error) {
    const code = isSmtpMissing(error) ? "SMTP_NOT_CONFIGURED" : workerFailureCode(error);
    await safeAudit(deps, { actorId: admin.id, action: "EMAIL_OUTBOX_DRAIN", metadata: { outcome: "failed", code, processed: null, sent: null, failed: null } });
    if (code === "SMTP_NOT_CONFIGURED") return json({ error: "SMTP konfiqurasiya edilməyib; növbə göndərilmədi.", code }, 503);
    return json({ error: `Növbəni göndərmək mümkün olmadı (${code}).`, code }, 500);
  }
  if (outcome.status === "busy") {
    await safeAudit(deps, { actorId: admin.id, action: "EMAIL_OUTBOX_DRAIN", metadata: { outcome: "busy", code: null, processed: null, sent: null, failed: null } });
    return json({ error: "Növbə hazırda göndərilir. Bir neçə saniyədən sonra yeniləyin." }, 409);
  }
  const { processed, sent, failed } = outcome.result;
  await safeAudit(deps, { actorId: admin.id, action: "EMAIL_OUTBOX_DRAIN", metadata: { outcome: "ran", code: null, processed, sent, failed } });
  return json({ ok: true, processed, sent, failed, message: processed ? `Emal edildi: ${processed} (göndərildi: ${sent}, uğursuz: ${failed}).` : "Göndəriləsi məktub yoxdur." });
}
