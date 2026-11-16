import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ConversationContextCard } from "@/components/conversation-list";
import { ConversationThread } from "@/components/conversation-thread";
import { storeInboxHref, storeThreadApi } from "@/lib/messaging-client";
import { requireStoreMessagingEnabled } from "@/lib/messaging-pages";
import { listMessages } from "@/lib/messaging-service";
import { getConversationView } from "@/lib/messaging-views";
import { prisma } from "@/lib/prisma";
import { requireVendorStorePage } from "@/lib/vendor-area";

export const dynamic = "force-dynamic";

/** One conversation of this store (another store's conversation is 404). The customer appears as "Aysel M." only. */
export default async function VendorConversationPage({ params }: { params: Promise<{ storeId: string; conversationId: string }> }) {
  const { storeId, conversationId } = await params;
  const access = await requireVendorStorePage(storeId);
  const settings = await requireStoreMessagingEnabled();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(conversationId)) notFound();
  const actor = { role: "STORE", userId: access.user.id, storeId: access.storeId } as const;
  const view = await getConversationView(prisma, { conversationId, actor });
  if (!view) notFound();
  const page = await listMessages(prisma, { conversationId: view.id, actor });
  return <div className="mx-auto max-w-3xl">
    <Link href={storeInboxHref(access.storeId)} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-[#173c40]"><ChevronLeft size={16} aria-hidden="true"/>Söhbətlər</Link>
    <header className="mt-1 grid gap-3">
      <h1 className="text-xl font-semibold text-[#142d38]">{view.counterpart}</h1>
      <ConversationContextCard
        context={view.context}
        product={view.product}
        order={view.order}
        productHref={view.product ? `/vendor/${encodeURIComponent(access.storeId)}/products/${encodeURIComponent(view.product.id)}` : null}
        orderHref={view.order ? `/vendor/${encodeURIComponent(access.storeId)}/orders/${encodeURIComponent(view.order.storeOrderId)}` : null}
      />
    </header>
    <div className="mt-4">
      <ConversationThread
        api={storeThreadApi(access.storeId, view.id)}
        viewerRole="STORE"
        counterpart={view.counterpart}
        initialMessages={page.items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() }))}
        initialHasOlder={Boolean(page.hasOlder)}
        initialUnread={view.unread}
        blockedByMe={view.blockedByMe}
        blockedByOther={view.blockedByOther}
        allowContactDetails={settings.allowContactDetails}
      />
    </div>
  </div>;
}
