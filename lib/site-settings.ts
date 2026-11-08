import { prisma } from "@/lib/prisma";
import { SITE_SETTINGS_DEFAULTS } from "@/lib/site-content";

export async function getSiteSettings() {
  const settings = await prisma.siteSettings.findUnique({ where: { id: SITE_SETTINGS_DEFAULTS.id } });
  return settings ?? SITE_SETTINGS_DEFAULTS;
}
