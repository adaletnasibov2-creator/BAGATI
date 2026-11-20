import { ConversationList } from "@/components/conversation-list";
import { storeThreadHref } from "@/lib/messaging-client";
import { requireStoreMessagingEnabled } from "@/lib/messaging-pages";
import { listConversations, unreadConversationCount } from "@/lib/messaging-service";
import { prisma } from "@/lib/prisma";
import { requireVendorStorePage } from "@/lib/vendor-area";
import { VendorPageHeader } from "@/components/vendor-page-header";

export const dynamic = "force-dynamic";

/**
 * "Söhbətlər": conversations customers started with this store (signed-in customers only). Separate from the
 * "Mesajlar" inbox of the anonymous store-page form. The customer is shown only by display name ("Aysel M.").
 */
export default async function VendorConversationsPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ cursor?: string }> }) {
  const { storeId } = await params;
  const access = await requireVendorStorePage(storeId);
  await requireStoreMessagingEnabled();
  const { cursor } = await searchParams;
  const actor = { role: "STORE", userId: access.user.id, storeId: access.storeId } as const;
  const [page, unread] = await Promise.all([
    listConversations(prisma, { actor, cursor: typeof cursor === "string" ? cursor : null }),
    unreadConversationCount(prisma, actor),
  ]);
  return <div className="space-y-5">
    <VendorPageHeader eyebrow="Müştəri söhbətləri" title="Söhbətlər" description={unread ? `${unread} söhbətdə oxunmamış mesaj var` : "Oxunmamış mesaj yoxdur"}/>
    <section className="rounded-card border border-line bg-white p-4 sm:p-5">
      <p className="text-xs leading-5 text-fg-secondary">
        Hesaba daxil olmuş müştərilər məhsul, sifariş və ya mağaza haqqında buradan yazır; siz cavab verirsiniz. Müştərinin e-poçtu və telefonu göstərilmir, mesajlarda da telefon və e-poçt paylaşmayın.
      </p>
    </section>
    <ConversationList
      items={page.items}
      viewerRole="STORE"
      hrefFor={(id) => storeThreadHref(access.storeId, id)}
      nextHref={page.nextCursor ? `/vendor/${encodeURIComponent(access.storeId)}/messages?cursor=${encodeURIComponent(page.nextCursor)}` : null}
      emptyTitle="Hələ söhbət yoxdur"
      emptyDetail="Müştəri məhsul, sifariş və ya mağaza səhifəsindən yazdıqda söhbət burada görünəcək."
    />
  </div>;
}
