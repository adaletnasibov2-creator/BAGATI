/** Sayt parametrləri (/admin/settings): Ümumi tab and the settings-engine tabs. Moved unchanged from app/admin/[...section]/page.tsx. */
import { prisma } from "@/lib/prisma";
import AdminSiteSettingsForm from "@/components/admin-site-settings-form";
import AdminSettingsTabs from "@/components/admin-settings-tabs";
import AdminSettingField from "@/components/admin-setting-field";
import { loadAdminSettingsGroup } from "@/lib/settings/admin";
import { SITE_SETTINGS_DEFAULTS } from "@/lib/site-content";
import { type SectionContext, Header } from "./shared";

export async function renderSettings({ sp, shell }: SectionContext) {
  // Settings-engine tabs (Maliyyə, SEO, Elan zolağı, Limitlər): one generic page per registry group.
  const engineTab=(["finance","seo","announcement","limits"] as const).find(tab=>tab===sp.tab);
  if(engineTab){
   const group=await loadAdminSettingsGroup(prisma,engineTab);
   return shell(<><Header title="Sayt parametrləri" detail={group.group.description}/><AdminSettingsTabs active={engineTab}/><div className="grid gap-4">{group.settings.map(view=><AdminSettingField key={view.key} view={view}/>)}</div></>);
  }
  const settings=await prisma.siteSettings.findUnique({where:{id:SITE_SETTINGS_DEFAULTS.id}});
  return shell(<><Header title="Sayt parametrləri" detail="Dəyişikliklər ictimai header, əlaqə məlumatları, qaydalar və ana səhifə təqdimatında görünür."/><AdminSettingsTabs active="general"/><AdminSiteSettingsForm initial={settings??SITE_SETTINGS_DEFAULTS}/></>);
}
