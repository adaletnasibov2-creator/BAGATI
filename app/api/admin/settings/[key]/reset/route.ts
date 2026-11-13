import { requireRole } from "@/lib/auth";
import { csrfRejection } from "@/lib/csrf";
import { handleSettingWrite, settingJson } from "@/lib/settings/http";

export const dynamic = "force-dynamic";

/** Returns the setting to its code default (a new version; history is kept). Order: same-origin -> ADMIN -> lib/settings/http.ts (permission, body, key, validation). */
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const admin = await requireRole("ADMIN");
  if (!admin) return settingJson({ error: "İcazə yoxdur" }, 403);
  return handleSettingWrite(request, admin, (await params).key, "reset");
}
