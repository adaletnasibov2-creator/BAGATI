import { ConversationList } from "@/components/conversation-list";
import { storeThreadHref } from "@/lib/messaging-client";
import { requireStoreMessagingEnabled } from "@/lib/messaging-pages";
import { listConversations, unreadConversationCount } from "@/lib/messaging-service";
import { prisma } from "@/lib/prisma";
import { requireVendorStorePage } from "@/lib/vendor-area";

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
    <section className="rounded-2xl border border-[#e9e4da] bg-white p-5 sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#967844]">Müştəri söhbətləri</p>
      <h1 className="mt-1 text-xl font-semibold text-[#142d38]">Söhbətlər</h1>
      <p className="mt-1 text-sm text-slate-600">{unread ? `${unread} söhbətdə oxunmamış mesaj var` : "Oxunmamış mesaj yoxdur"}</p>
      <p className="mt-4 rounded-xl bg-[#f8f7f4] p-3 text-xs leading-5 text-slate-600">
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
