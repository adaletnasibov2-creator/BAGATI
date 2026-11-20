import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ConversationContextCard } from "@/components/conversation-list";
import { NewConversationForm } from "@/components/new-conversation-form";
import { customerThreadHref, newConversationHref } from "@/lib/messaging-client";
import { customerMessagesBadge, requireCustomerMessagingPage } from "@/lib/messaging-pages";
import { resolveNewConversationTarget } from "@/lib/messaging-views";
import { prisma } from "@/lib/prisma";
import { AccountShell } from "@/components/account-shell";

export const dynamic = "force-dynamic";
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const one = (value: string | string[] | undefined) => (typeof value === "string" && ID.test(value) ? value : null);

/**
 * "Mağazaya yaz" / "Bu məhsul haqqında soruş": a first message to a store about a product, one of the customer's own
 * store orders, or the store in general. When that thread exists already, it opens instead.
 */
export default async function NewConversationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const storeId = one(query.store);
  const productId = one(query.product);
  const storeOrderId = one(query.order);
  const self = storeId ? newConversationHref({ storeId, productId, storeOrderId }) : "/account/messages";
  const { user, settings } = await requireCustomerMessagingPage(self);
  if (!storeId) notFound();
  const target = await resolveNewConversationTarget(prisma, { customerId: user.id, storeId, productId, storeOrderId });
  if (!target) notFound();
  if (target.existingConversationId) redirect(customerThreadHref(target.existingConversationId));
  const productHref = target.product ? `/products/${encodeURIComponent(target.product.id)}` : null;
  const orderHref = target.order ? `/orders/${encodeURIComponent(target.order.orderId)}` : null;
  // The shared .container sets its own max-width, so the reading width is limited by an inner wrapper.
  const messagesUnread = await customerMessagesBadge(user.id);
  return <AccountShell messagesUnread={messagesUnread} back={<Link href={productHref ?? orderHref ?? `/stores/${encodeURIComponent(target.store.id)}`} className="inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium text-primary hover:text-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"><ChevronLeft size={16} aria-hidden="true"/>Geri</Link>} eyebrow="Mağazaya yaz" title={target.store.name}><div className="max-w-3xl">
    <ConversationContextCard context={target.context} product={target.product} order={target.order} productHref={productHref} orderHref={orderHref}/>
    <div className="mt-4 rounded-card border border-line bg-white p-4 sm:p-5">
      <NewConversationForm storeId={target.store.id} context={target.context} contextId={target.contextId} allowContactDetails={settings.allowContactDetails}/>
      <p className="mt-3 text-xs leading-5 text-fg-muted">Mağazanın cavabı “Mesajlarım” bölməsinə gələcək; yeni cavab barədə sizə e-poçtla xəbər veriləcək.</p>
    </div>
  </div></AccountShell>;
}
