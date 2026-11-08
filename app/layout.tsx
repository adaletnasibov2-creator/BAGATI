import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import { AuthSessionSync } from "@/components/auth-session-sync";
import { getSiteSettings } from "@/lib/site-settings";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const settings = await getSiteSettings();
  return {
    title: { default: settings.siteName, template: `%s | ${settings.siteName}` },
    description: "Azərbaycan mağazalarını və məhsullarını bir marketplace-də kəşf edin.",
    applicationName: settings.siteName,
    icons: { icon: settings.logoUrl ?? "/icon.svg", shortcut: settings.logoUrl ?? "/icon.svg" },
  };
}
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="az"><body><AuthSessionSync/>{children}</body></html>; }
