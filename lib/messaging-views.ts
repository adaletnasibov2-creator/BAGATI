/**
 * Read models for the messaging pages (phase 5/6). Server-only. Like the service, nothing here returns an e-mail
 * address or phone number: the store sees the customer display name, the customer sees the store name.
 */
import type { PrismaClient } from "@prisma/client";
import { conversationContextKey, customerDisplayName, type ConversationContextValue } from "@/lib/messaging";
import type { MessagingActor } from "@/lib/messaging-service";
import { resolvePublicStoreEligibility, type PublicStoreEligibilityClient } from "@/lib/public-store-eligibility";

type Db = PrismaClient;

export type ConversationView = {
  id: string;
  context: ConversationContextValue;
  store: { id: string; name: string };
  counterpart: string;
  product: { id: string; name: string } | null;
  order: { orderId: string; storeOrderId: string; ref: string } | null;
  blockedByMe: boolean;
  blockedByOther: boolean;
  /** The viewer's own unread count for this thread. */
  unread: number;
};

/** One conversation for its own customer or its own store; null for anything else (the route answers 404). */
export async function getConversationView(db: Db, input: { conversationId: string; actor: MessagingActor }): Promise<ConversationView | null> {
  const row = await db.conversation.findUnique({
    where: { id: input.conversationId },
    select: {
      id: true, context: true, storeId: true, customerId: true, customerUnreadCount: true, storeUnreadCount: true,
      store: { select: { id: true, name: true } },
      customer: { select: { customerProfile: { select: { firstName: true, lastName: true } } } },
      product: { select: { id: true, name: true } },
      storeOrder: { select: { id: true, orderId: true } },
    },
  });
  // Orphans (customer account deleted, kept for an OPEN report) are admin-only: never shown to a store or a customer.
  if (!row || row.customerId === null) return null;
  const own = input.actor.role === "CUSTOMER" ? row.customerId === input.actor.userId : row.storeId === input.actor.storeId;
  if (!own) return null;
  const blocks = await db.conversationBlock.findMany({ where: { storeId: row.storeId, customerId: row.customerId }, select: { side: true } });
  return {
    id: row.id,
    context: row.context,
    store: row.store,
    counterpart: input.actor.role === "CUSTOMER" ? row.store.name : customerDisplayName(row.customer?.customerProfile?.firstName, row.customer?.customerProfile?.lastName),
    product: row.product,
    order: row.storeOrder ? { orderId: row.storeOrder.orderId, storeOrderId: row.storeOrder.id, ref: row.storeOrder.orderId.slice(-8).toUpperCase() } : null,
    blockedByMe: blocks.some((block) => block.side === input.actor.role),
    blockedByOther: blocks.some((block) => block.side !== input.actor.role),
    unread: input.actor.role === "CUSTOMER" ? row.customerUnreadCount : row.storeUnreadCount,
  };
}

export type NewConversationTarget = {
  store: { id: string; name: string };
  context: ConversationContextValue;
  contextId: string | null;
  product: { id: string; name: string } | null;
  order: { orderId: string; storeOrderId: string; ref: string } | null;
  existingConversationId: string | null;
};

/**
 * What the "new message" page may offer to this customer: a publicly eligible store, and the store's active product or
 * the customer's own store order of that store. Null when any part is not valid (the page answers 404). When the thread
 * for this context exists already, its id is returned so the page can open it instead.
 */
export async function resolveNewConversationTarget(
  db: Db,
  input: { customerId: string; storeId: string; productId?: string | null; storeOrderId?: string | null; now?: Date },
): Promise<NewConversationTarget | null> {
  if (input.productId && input.storeOrderId) return null;
  const eligible = await resolvePublicStoreEligibility([input.storeId], db as unknown as PublicStoreEligibilityClient, input.now ?? new Date());
  if (!eligible.has(input.storeId)) return null;
  const store = await db.store.findUnique({ where: { id: input.storeId }, select: { id: true, name: true } });
  if (!store) return null;
  let context: ConversationContextValue = "STORE";
  let contextId: string | null = null;
  let product: NewConversationTarget["product"] = null;
  let order: NewConversationTarget["order"] = null;
  if (input.productId) {
    product = await db.product.findFirst({ where: { id: input.productId, storeId: store.id, status: "ACTIVE" }, select: { id: true, name: true } });
    if (!product) return null;
    context = "PRODUCT";
    contextId = product.id;
  } else if (input.storeOrderId) {
    const storeOrder = await db.storeOrder.findFirst({ where: { id: input.storeOrderId, storeId: store.id, order: { userId: input.customerId } }, select: { id: true, orderId: true } });
    if (!storeOrder) return null;
    context = "ORDER";
    contextId = storeOrder.id;
    order = { orderId: storeOrder.orderId, storeOrderId: storeOrder.id, ref: storeOrder.orderId.slice(-8).toUpperCase() };
  }
  const existing = await db.conversation.findUnique({
    where: { customerId_storeId_contextKey: { customerId: input.customerId, storeId: store.id, contextKey: conversationContextKey(context, contextId) } },
    select: { id: true },
  });
  return { store, context, contextId, product, order, existingConversationId: existing?.id ?? null };
}
