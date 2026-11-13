import { prisma } from "@/lib/prisma";
import { enqueueEmail } from "@/lib/email-outbox";
import { readJsonBodyLimited } from "@/lib/request-json";
import { reapplyRulesFrom, SELLER_APPLICATION_MESSAGES, SELLER_APPLICATION_RULES, sellerApplicationInputSchema, sellerApplicationIssue } from "@/lib/seller-application";
import { SellerApplicationError, submitSellerApplication } from "@/lib/seller-application-service";
import { applicantErrorResponse, applicantJson, guardApplicantRequest } from "@/lib/seller-application-http";

export const dynamic = "force-dynamic";

/**
 * A customer applies to become a seller. The role stays CUSTOMER: only an admin approval
 * (lib/seller-application-service.ts approveSellerApplication) changes it to VENDOR.
 */
export async function POST(request: Request) {
  const guard = await guardApplicantRequest(request, "/api/vendor/apply");
  if ("response" in guard) return guard.response;
  const body = await readJsonBodyLimited(request, SELLER_APPLICATION_RULES.bodyBytes);
  if (!body.ok) return applicantJson({ error: SELLER_APPLICATION_MESSAGES.invalid }, body.status);
  const parsed = sellerApplicationInputSchema.safeParse(body.value);
  if (!parsed.success) return applicantJson({ error: sellerApplicationIssue(parsed.error), details: parsed.error.flatten() }, 422);

  try {
    const application = await submitSellerApplication(prisma, { userId: guard.user.id, data: parsed.data, enqueue: (tx, email) => enqueueEmail(tx, email), rules: reapplyRulesFrom(guard.limits) });
    return applicantJson({ ok: true, application, message: SELLER_APPLICATION_MESSAGES.submitted }, 201);
  } catch (error) {
    if (error instanceof SellerApplicationError) return applicantErrorResponse(error);
    console.error(JSON.stringify({ event: "seller_application.submit.failed", name: error instanceof Error ? error.name : "unknown" }));
    return applicantJson({ error: SELLER_APPLICATION_MESSAGES.unavailable }, 500);
  }
}
