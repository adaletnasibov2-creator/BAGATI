import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { readJsonBodyLimited } from "@/lib/request-json";
import { SELLER_APPLICATION_MESSAGES } from "@/lib/seller-application";
import { SellerApplicationError, withdrawSellerApplication } from "@/lib/seller-application-service";
import { applicantErrorResponse, applicantJson, guardApplicantRequest } from "@/lib/seller-application-http";

export const dynamic = "force-dynamic";
const schema = z.object({ applicationId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }).strict();

/** The applicant withdraws their own PENDING application. */
export async function POST(request: Request) {
  const guard = await guardApplicantRequest(request, "/api/vendor/apply/withdraw");
  if ("response" in guard) return guard.response;
  const body = await readJsonBodyLimited(request, 1024);
  const parsed = body.ok ? schema.safeParse(body.value) : null;
  if (!parsed?.success) return applicantJson({ error: SELLER_APPLICATION_MESSAGES.invalid }, 400);
  try {
    await withdrawSellerApplication(prisma, { userId: guard.user.id, applicationId: parsed.data.applicationId });
    return applicantJson({ ok: true, message: SELLER_APPLICATION_MESSAGES.withdrawn });
  } catch (error) {
    if (error instanceof SellerApplicationError) return applicantErrorResponse(error);
    console.error(JSON.stringify({ event: "seller_application.withdraw.failed", name: error instanceof Error ? error.name : "unknown" }));
    return applicantJson({ error: SELLER_APPLICATION_MESSAGES.unavailable }, 500);
  }
}
