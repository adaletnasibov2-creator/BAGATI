import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";
import { AuthSessionSync } from "@/components/auth-session-sync";
import { getSiteSettings } from "@/lib/site-settings";
import { getSetting } from "@/lib/settings/read";
import { SETTING_KEYS } from "@/lib/settings/registry";
import { rootMetadata } from "@/lib/seo";
import { shareImage } from "@/lib/share-preview";

/** Cached (30 s) and fail-safe: a settings read never breaks the page; the code defaults apply. */
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const [settings, description, ogTitle, ogDescription] = await Promise.all([
    getSiteSettings(),
    getSetting<string>(SETTING_KEYS.seoDefaultDescription),
    getSetting<string>(SETTING_KEYS.seoDefaultOgTitle),
    getSetting<string>(SETTING_KEYS.seoDefaultOgDescription),
  ]);
  // LAUNCH-TECH-1: the default 1200x630 share image for pages without their own (absolute https from APP_BASE_URL, else none).
  return rootMetadata({ siteName: settings.siteName, logoUrl: settings.logoUrl, description: description ?? "", ogTitle, ogDescription, shareImage: shareImage([], settings.siteName) });
}
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="az"><body><AuthSessionSync/>{children}</body></html>; }
