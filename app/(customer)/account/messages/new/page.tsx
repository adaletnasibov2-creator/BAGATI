import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ConversationContextCard } from "@/components/conversation-list";
import { NewConversationForm } from "@/components/new-conversation-form";
import { customerThreadHref, newConversationHref } from "@/lib/messaging-client";
import { requireCustomerMessagingPage } from "@/lib/messaging-pages";
import { resolveNewConversationTarget } from "@/lib/messaging-views";
import { prisma } from "@/lib/prisma";

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
  return <div className="container py-5 md:py-10"><div className="mx-auto max-w-3xl">
    <Link href={productHref ?? orderHref ?? `/stores/${encodeURIComponent(target.store.id)}`} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-emerald"><ChevronLeft size={16} aria-hidden="true"/>Geri</Link>
    <header className="mt-1 grid gap-3">
      <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#967844]">Mağazaya yaz</p>
      <h1 className="text-xl font-semibold text-ink sm:text-2xl">{target.store.name}</h1>
      <ConversationContextCard context={target.context} product={target.product} order={target.order} productHref={productHref} orderHref={orderHref}/>
    </header>
    <div className="mt-4 rounded-2xl border border-[#E5E1D7] bg-white p-4 sm:p-5">
      <NewConversationForm storeId={target.store.id} context={target.context} contextId={target.contextId} allowContactDetails={settings.allowContactDetails}/>
      <p className="mt-3 text-xs leading-5 text-muted">Mağazanın cavabı “Mesajlarım” bölməsinə gələcək; yeni cavab barədə sizə e-poçtla xəbər veriləcək.</p>
    </div>
  </div></div>;
}
