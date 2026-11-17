import Link from "next/link";
import { MessageCircle, Package, ShoppingBag, Store } from "lucide-react";
import { formatMessageTime } from "@/lib/messaging-client";

export type ConversationListItem = {
  id: string;
  context: "PRODUCT" | "ORDER" | "STORE";
  counterpart: string;
  product: { id: string; name: string } | null;
  orderRef: string | null;
  lastMessageAt: Date;
  lastMessagePreview: string;
  lastSenderRole: "CUSTOMER" | "STORE";
  unread: number;
};

export function conversationContextLabel(item: { context: "PRODUCT" | "ORDER" | "STORE"; product: { name: string } | null; orderRef: string | null }) {
  if (item.context === "PRODUCT") return item.product ? `Məhsul: ${item.product.name}` : "Məhsul (artıq satışda deyil)";
  if (item.context === "ORDER") return item.orderRef ? `Sifariş · ${item.orderRef}` : "Sifariş";
  return "Ümumi sual";
}

const ContextIcon = ({ context }: { context: ConversationListItem["context"] }) =>
  context === "PRODUCT" ? <Package size={14} aria-hidden="true"/> : context === "ORDER" ? <ShoppingBag size={14} aria-hidden="true"/> : <Store size={14} aria-hidden="true"/>;

/** Inbox rows for either side. Plain text only; the preview was cut to one line when it was stored. */
export function ConversationList({ items, viewerRole, hrefFor, nextHref, emptyTitle, emptyDetail }: {
  items: ConversationListItem[];
  viewerRole: "CUSTOMER" | "STORE";
  hrefFor: (id: string) => string;
  nextHref: string | null;
  emptyTitle: string;
  emptyDetail: string;
}) {
  if (!items.length) {
    return <section className="rounded-2xl border border-dashed border-[#DED9CF] bg-white p-8 text-center">
      <MessageCircle aria-hidden="true" className="mx-auto text-[#B89758]" size={28}/>
      <h2 className="mt-3 font-semibold text-[#142D38]">{emptyTitle}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">{emptyDetail}</p>
    </section>;
  }
  return <div className="grid min-w-0 gap-3">
    <ul className="grid min-w-0 gap-2.5">
      {items.map((item) => {
        const unread = item.unread > 0;
        return <li key={item.id} className="min-w-0">
          <Link href={hrefFor(item.id)} className={`block rounded-2xl border bg-white p-4 transition hover:border-[#93ADA0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52] ${unread ? "border-[#C9973A]/60" : "border-[#E5E1D7]"}`}>
            <div className="flex items-start justify-between gap-3">
              <p className={`min-w-0 truncate text-[15px] ${unread ? "font-semibold text-[#142D38]" : "font-medium text-[#24323D]"}`}>{item.counterpart}</p>
              <span className="shrink-0 text-xs text-[#6B7680]">{formatMessageTime(item.lastMessageAt)}</span>
            </div>
            <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-[#967844]"><ContextIcon context={item.context}/><span className="truncate">{conversationContextLabel(item)}</span></p>
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <p className={`min-w-0 truncate text-sm ${unread ? "text-[#16202C]" : "text-[#5B6672]"}`}>{item.lastSenderRole === viewerRole ? "Siz: " : ""}{item.lastMessagePreview}</p>
              {unread && <span className="shrink-0 rounded-full bg-[#C9973A] px-2 py-0.5 text-[11px] font-semibold text-white" aria-label={`${item.unread} oxunmamış mesaj`}>{item.unread > 99 ? "99+" : item.unread}</span>}
            </div>
          </Link>
        </li>;
      })}
    </ul>
    {nextHref && <div className="text-center"><Link href={nextHref} rel="next" className="inline-flex min-h-11 items-center rounded-full border border-[#D9E0DC] bg-white px-5 text-sm font-medium text-[#2F5D50] hover:bg-[#F2F6F3]">Daha çox söhbət</Link></div>}
  </div>;
}

/** What the conversation is about: a product, an order, or a general question about the store. */
export function ConversationContextCard({ context, product, order, productHref, orderHref }: {
  context: "PRODUCT" | "ORDER" | "STORE";
  product: { id: string; name: string } | null;
  order: { ref: string } | null;
  productHref: string | null;
  orderHref: string | null;
}) {
  const label = conversationContextLabel({ context, product, orderRef: order?.ref ?? null });
  const href = context === "PRODUCT" ? productHref : context === "ORDER" ? orderHref : null;
  return <div className="flex items-center gap-3 rounded-xl bg-[#F7F5EF] p-3 text-sm">
    <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-[#2F5D50]"><ContextIcon context={context}/></span>
    <div className="min-w-0 flex-1">
      <p className="text-[11px] font-semibold uppercase tracking-[.12em] text-[#967844]">Mövzu</p>
      {href ? <Link href={href} className="block truncate font-medium text-[#173A3A] underline-offset-2 hover:underline">{label}</Link> : <p className="truncate font-medium text-[#24323D]">{label}</p>}
    </div>
  </div>;
}
