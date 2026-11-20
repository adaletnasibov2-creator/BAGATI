import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ConversationContextCard } from "@/components/conversation-list";
import { ConversationThread } from "@/components/conversation-thread";
import { customerInboxHref, customerThreadApi } from "@/lib/messaging-client";
import { customerMessagesBadge, requireCustomerMessagingPage } from "@/lib/messaging-pages";
import { listMessages } from "@/lib/messaging-service";
import { getConversationView } from "@/lib/messaging-views";
import { prisma } from "@/lib/prisma";
import { AccountShell } from "@/components/account-shell";

export const dynamic = "force-dynamic";

/** One conversation with a store, for its own customer only (anything else is 404). */
export default async function CustomerConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  const { user, settings } = await requireCustomerMessagingPage(`/account/messages/${encodeURIComponent(conversationId)}`);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(conversationId)) notFound();
  const actor = { role: "CUSTOMER", userId: user.id } as const;
  const view = await getConversationView(prisma, { conversationId, actor });
  if (!view) notFound();
  const page = await listMessages(prisma, { conversationId: view.id, actor });
  // The shared .container sets its own max-width, so the reading width is limited by an inner wrapper.
  const messagesUnread = await customerMessagesBadge(user.id);
  return <AccountShell messagesUnread={messagesUnread} back={<Link href={customerInboxHref} className="inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium text-primary hover:text-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"><ChevronLeft size={16} aria-hidden="true"/>Mesajlarım</Link>} eyebrow="Mesajlarım" title={<Link href={`/stores/${encodeURIComponent(view.store.id)}`} className="rounded-sm hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">{view.store.name}</Link>}><div className="max-w-3xl">
    <div className="grid gap-3">
      <ConversationContextCard
        context={view.context}
        product={view.product}
        order={view.order}
        productHref={view.product ? `/products/${encodeURIComponent(view.product.id)}` : null}
        orderHref={view.order ? `/orders/${encodeURIComponent(view.order.orderId)}` : null}
      />
    </div>
    <div className="mt-4">
      <ConversationThread
        api={customerThreadApi(view.id)}
        viewerRole="CUSTOMER"
        counterpart={view.counterpart}
        initialMessages={page.items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() }))}
        initialHasOlder={Boolean(page.hasOlder)}
        initialUnread={view.unread}
        blockedByMe={view.blockedByMe}
        blockedByOther={view.blockedByOther}
        allowContactDetails={settings.allowContactDetails}
      />
    </div>
  </div></AccountShell>;
}
