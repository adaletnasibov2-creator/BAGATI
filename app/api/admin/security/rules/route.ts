import { prisma } from "@/lib/prisma";
import { listRules } from "@/lib/security-monitoring/admin";
import { authorizeSecurityAdmin, securityErrorResponse, securityJson } from "@/lib/security-monitoring/http";
import { RULE_BOUNDS } from "@/lib/security-monitoring/rules";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeSecurityAdmin(request, "security.view", { write: false });
  if ("response" in auth) return auth.response;
  try {
    return securityJson({ rules: await listRules(prisma), bounds: RULE_BOUNDS });
  } catch (error) {
    return securityErrorResponse("admin_security_rules_list", error);
  }
}
