import { CustomerFooter } from "@/components/customer-footer";
import { Header } from "@/components/header";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { currentUser } from "@/lib/auth";
import { getActiveCities } from "@/lib/active-cities";
import { getPublicCategoryData } from "@/lib/public-category-tree";
import { getSiteSettings } from "@/lib/site-settings";
import { getPublicContact } from "@/lib/public-contact";
import AnnouncementBar from "@/components/announcement-bar";
import { customerMessagesBadge } from "@/lib/messaging-pages";
import { PublicTheme } from "@/components/public-theme";

export const dynamic = "force-dynamic";

export default async function CustomerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [settings, user, cities, categories, contact] = await Promise.all([
    getSiteSettings(),
    currentUser(),
    // Active cities by name, cached for 30 s (lib/active-cities.ts, SCALE-FIX-2 A6).
    getActiveCities(),
    // All top-levels with visible products, in sortOrder (no count limit, so no top-level is cut off), each with its
    // visible subcategories. Hidden when empty (owner decision 2026-11-15).
    getPublicCategoryData().then((data) => data.tree),
    getPublicContact(),
  ]);
  const publicUser = user ? { email: user.email, displayName: user.displayName, role: user.role } : null;
  // "Mesajlarım" in the account menu: customers only, hidden (null) while messaging is OFF.
  const messagesUnread = user?.role === "CUSTOMER" ? await customerMessagesBadge(user.id) : null;

  return (
    <PublicTheme>
      <AnnouncementBar />
      <Header
        branding={{ siteName: settings.siteName, logoUrl: settings.logoUrl }}
        user={publicUser}
        messagesUnread={messagesUnread}
        cities={cities}
        categories={categories}
      />
      <main className="min-h-[55vh]">{children}</main>
      <CustomerFooter settings={settings} contact={contact} />
      <MobileBottomNav user={publicUser ? { role: publicUser.role } : null} />
    </PublicTheme>
  );
}
