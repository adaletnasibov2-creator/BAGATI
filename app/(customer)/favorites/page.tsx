import { FavoritesClient } from "@/components/favorites-client";
import { AccountShell } from "@/components/account-shell";
import { currentUser } from "@/lib/auth";
import { customerMessagesBadge } from "@/lib/messaging-pages";

/**
 * Favorites live in the browser (localStorage), so the page works without signing in. A signed-in customer sees it inside
 * the account layout (DESIGN-T7); everyone else sees it as before. Same texts.
 */
export default async function FavoritesPage() {
  const user = await currentUser();
  if (user?.role === "CUSTOMER") {
    const messagesUnread = await customerMessagesBadge(user.id);
    return <AccountShell eyebrow="Sənin seçimlərin" title="Sevimlilər" messagesUnread={messagesUnread}><FavoritesClient/></AccountShell>;
  }
  return <div className="container py-9 sm:py-12"><p className="text-kicker uppercase text-gold-700">Sənin seçimlərin</p><h1 className="mt-2 font-display text-h1 text-fg">Sevimlilər</h1><div className="mt-7"><FavoritesClient/></div></div>;
}
