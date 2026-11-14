/** Sayt parametrləri (/admin/settings): Ümumi tab (site form + contact and footer settings) and the settings-engine tabs. */
import { prisma } from "@/lib/prisma";
import AdminSiteSettingsForm from "@/components/admin-site-settings-form";
import AdminSettingsTabs from "@/components/admin-settings-tabs";
import AdminSettingField from "@/components/admin-setting-field";
import { PageHeader } from "@/components/admin-ui/page-header";
import { loadAdminSettingsGroup } from "@/lib/settings/admin";
import { SITE_SETTINGS_DEFAULTS } from "@/lib/site-content";
import { type SectionContext } from "./shared";

export async function renderSettings({ sp, shell }: SectionContext) {
  // Settings-engine tabs (Maliyyə, SEO, Elan zolağı, Limitlər, Texniki iş): one generic page per registry group.
  const engineTab=(["finance","seo","announcement","limits","maintenance"] as const).find(tab=>tab===sp.tab);
  if(engineTab){
   const group=await loadAdminSettingsGroup(prisma,engineTab);
   return shell(<><PageHeader title="Sayt parametrləri" description={group.group.description}/><AdminSettingsTabs active={engineTab}/><div className="grid gap-4">{group.settings.map(view=><AdminSettingField key={view.key} view={view}/>)}</div></>);
  }
  const [settings, contact, footer] = await Promise.all([
    prisma.siteSettings.findUnique({where:{id:SITE_SETTINGS_DEFAULTS.id}}),
    loadAdminSettingsGroup(prisma, "contact"),
    loadAdminSettingsGroup(prisma, "footer"),
  ]);
  return shell(<>
    <PageHeader title="Sayt parametrləri" description="Dəyişikliklər ictimai header, əlaqə məlumatları, qaydalar və ana səhifə təqdimatında görünür."/>
    <AdminSettingsTabs active="general"/>
    <AdminSiteSettingsForm initial={settings??SITE_SETTINGS_DEFAULTS}/>
    {[contact, footer].map((group) => <section key={group.group.label} className="mt-8" aria-labelledby={`settings-group-${group.group.label}`}>
      <h2 id={`settings-group-${group.group.label}`} className="text-lg font-semibold text-[#0d1b2a]">{group.group.label}</h2>
      <p className="mb-3 mt-1 text-sm text-slate-500">{group.group.description}</p>
      <div className="grid gap-4">{group.settings.map((view) => <AdminSettingField key={view.key} view={view}/>)}</div>
    </section>)}
  </>);
}
