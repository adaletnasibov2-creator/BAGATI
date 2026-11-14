import Link from "next/link";

export const ADMIN_SETTINGS_TABS = [
  { id: "general", label: "Ümumi", href: "/admin/settings" },
  { id: "finance", label: "Maliyyə", href: "/admin/settings?tab=finance" },
  { id: "seo", label: "SEO", href: "/admin/settings?tab=seo" },
  { id: "announcement", label: "Elan zolağı", href: "/admin/settings?tab=announcement" },
  { id: "limits", label: "Limitlər", href: "/admin/settings?tab=limits" },
  { id: "maintenance", label: "Texniki iş", href: "/admin/settings?tab=maintenance" },
] as const;
export type AdminSettingsTab = (typeof ADMIN_SETTINGS_TABS)[number]["id"];

/** Tabs of "Sayt parametrləri". Plain links, so each tab is its own server-rendered page and works without JavaScript. */
export default function AdminSettingsTabs({ active }: { active: AdminSettingsTab }) {
  return <nav aria-label="Parametr bölmələri" className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-[#e7e3d9] bg-white p-1">
    {ADMIN_SETTINGS_TABS.map((tab) => <Link key={tab.id} href={tab.href} aria-current={tab.id === active ? "page" : undefined}
      className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium ${tab.id === active ? "bg-[#173c40] text-white" : "text-slate-700 hover:bg-[#f3f1ec]"}`}>{tab.label}</Link>)}
  </nav>;
}
