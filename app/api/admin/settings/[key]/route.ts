import { requireRole } from "@/lib/auth";
import { csrfRejection } from "@/lib/csrf";
import { handleSettingWrite, settingJson } from "@/lib/settings/http";

export const dynamic = "force-dynamic";

/** Sets a settings-engine value (admin input format). Order: same-origin -> ADMIN -> lib/settings/http.ts (permission, body, key, validation). */
export async function PUT(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const admin = await requireRole("ADMIN");
  if (!admin) return settingJson({ error: "İcazə yoxdur" }, 403);
  return handleSettingWrite(request, admin, (await params).key, "update");
}
