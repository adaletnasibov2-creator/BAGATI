import Link from "next/link";
import { AccountNavigation } from "@/components/account-navigation";
import { ConversationList } from "@/components/conversation-list";
import { customerThreadHref } from "@/lib/messaging-client";
import { customerMessagesBadge, requireCustomerMessagingPage } from "@/lib/messaging-pages";
import { listConversations } from "@/lib/messaging-service";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** "Mesajlarım": the customer's conversations with stores, newest activity first (cursor pages). */
export default async function CustomerMessagesPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const { user } = await requireCustomerMessagingPage("/account/messages");
  const { cursor } = await searchParams;
  const [page, unread] = await Promise.all([
    listConversations(prisma, { actor: { role: "CUSTOMER", userId: user.id }, cursor: typeof cursor === "string" ? cursor : null }),
    customerMessagesBadge(user.id),
  ]);
  return <div className="container py-8 md:py-14">
    <p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald"><Link href="/account">Hesabım</Link></p>
    <h1 className="mt-2 mb-6 text-2xl font-semibold text-ink sm:mb-8 sm:text-3xl">Mesajlarım</h1>
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[230px_1fr] lg:gap-8">
      <AccountNavigation messagesUnread={unread}/>
      <div className="grid min-w-0 content-start gap-4">
        <p className="text-sm text-muted">Mağazalarla yazışmalarınız. Məhsul səhifəsində “Bu məhsul haqqında soruş”, sifarişdə və ya mağaza səhifəsində “Mağazaya yaz” ilə yeni sual verə bilərsiniz.</p>
        <ConversationList
          items={page.items}
          viewerRole="CUSTOMER"
          hrefFor={customerThreadHref}
          nextHref={page.nextCursor ? `/account/messages?cursor=${encodeURIComponent(page.nextCursor)}` : null}
          emptyTitle="Hələ mesajınız yoxdur"
          emptyDetail="Mağazaya yazdığınız suallar və cavablar burada görünəcək."
        />
      </div>
    </div>
  </div>;
}
