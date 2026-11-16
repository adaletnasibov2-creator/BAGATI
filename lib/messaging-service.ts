/**
 * Customer <-> store messaging service (phase 4). The only code that writes the messaging tables.
 *
 * - Every write that touches a conversation runs in one transaction that first locks the conversation row
 *   (SELECT ... FOR UPDATE), then re-reads it, so concurrent sends, reads and blocks cannot lose an unread count.
 * - Unread counters live on the conversation; a send increments the other side's counter and clears the sender's own.
 * - Only a customer starts a conversation; the store only replies (owner decision).
 * - Settings (switch, contact-detail rule, limits) arrive as parameters (lib/messaging-settings.ts loads them), and the
 *   rate limiter is injectable, so the rules are testable without the settings engine.
 * - Outputs never contain e-mail addresses or phone numbers: the store sees a customer display name ("Aysel M."), the
 *   customer sees the store name.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { authRateLimitKey, consumeAuthRateLimit } from "@/lib/auth-rate-limit";
import { enqueueEmail } from "@/lib/email-outbox";
import {
  conversationContextKey,
  customerDisplayName,
  isReportReason,
  MESSAGE_LIMITS,
  messageEmailEventKey,
  messagePreview,
  MESSAGING_TEXT,
  MESSAGING_WINDOWS,
  validateMessageBody,
  type ConversationContextValue,
  type MessageSenderRoleValue,
  type ReportReason,
} from "@/lib/messaging";
import type { MessagingSettings } from "@/lib/messaging-settings";
import { resolvePublicStoreEligibility, type PublicStoreEligibilityClient } from "@/lib/public-store-eligibility";

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

export type MessagingActor =
  | { role: "CUSTOMER"; userId: string }
  | { role: "STORE"; userId: string; storeId: string };

export type RateLimiter = (identity: string, limit: number, windowMs: number) => Promise<boolean>;
const defaultRateLimiter: RateLimiter = (identity, limit, windowMs) => consumeAuthRateLimit(authRateLimitKey("messaging", identity), limit, windowMs);

export type MessagingContext = {
  settings: MessagingSettings;
  rateLimit?: RateLimiter;
  now?: () => Date;
  /** For the link in notification e-mails (no link when unset or not http(s)). */
  appBaseUrl?: string;
};

export class MessagingError extends Error {
  constructor(
    readonly code:
      | "DISABLED"
      | "NOT_FOUND"
      | "STORE_UNAVAILABLE"
      | "CONTEXT_INVALID"
      | "BLOCKED"
      | "RATE_LIMITED"
      | "INVALID_BODY"
      | "INVALID",
    readonly userMessage: string = MESSAGING_TEXT.disabled,
  ) {
    super(code);
    this.name = "MessagingError";
  }
}

const fail = (code: MessagingError["code"], message?: string): never => { throw new MessagingError(code, message); };

function requireEnabled(ctx: MessagingContext) {
  if (!ctx.settings.enabled) fail("DISABLED", MESSAGING_TEXT.disabled);
}

function cleanBody(raw: unknown, ctx: MessagingContext): string {
  const result = validateMessageBody(raw, { allowContactDetails: ctx.settings.allowContactDetails });
  if (!result.ok) fail("INVALID_BODY", result.message);
  return (result as { ok: true; body: string }).body;
}

function appLink(base: string | undefined, path: string): string | null {
  if (!base) return null;
  try {
    const url = new URL(base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}${path}`;
  } catch {
    return null;
  }
}

async function consumeLimits(ctx: MessagingContext, checks: [identity: string, limit: number, windowMs: number][]) {
  const limiter = ctx.rateLimit ?? defaultRateLimiter;
  for (const [identity, limit, windowMs] of checks) {
    if (!(await limiter(identity, limit, windowMs))) fail("RATE_LIMITED", MESSAGING_TEXT.rateLimited);
  }
}

async function isBlocked(db: Pick<Db, "conversationBlock"> | Tx, storeId: string, customerId: string) {
  return (await db.conversationBlock.count({ where: { storeId, customerId } })) > 0;
}

async function storeAcceptsMessages(db: Db, storeId: string, now: Date) {
  return (await resolvePublicStoreEligibility([storeId], db as unknown as PublicStoreEligibilityClient, now)).has(storeId);
}

async function lockConversation(tx: Tx, conversationId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Conversation" WHERE "id" = ${conversationId} FOR UPDATE`;
}

/** Inserts a message and moves the counters, inside a transaction that already holds the conversation lock. */
async function appendMessage(tx: Tx, input: { conversationId: string; storeId: string; customerId: string; sender: MessagingActor; body: string; now: Date; appBaseUrl?: string }) {
  const message = await tx.conversationMessage.create({
    data: { conversationId: input.conversationId, senderRole: input.sender.role, senderUserId: input.sender.userId, body: input.body, createdAt: input.now },
    select: { id: true, createdAt: true },
  });
  const fromCustomer = input.sender.role === "CUSTOMER";
  await tx.conversation.update({
    where: { id: input.conversationId },
    data: {
      lastMessageAt: input.now,
      lastMessagePreview: messagePreview(input.body),
      lastSenderRole: input.sender.role,
      // The other side gets one more unread message; replying means the sender has read the thread.
      ...(fromCustomer
        ? { storeUnreadCount: { increment: 1 }, customerUnreadCount: 0, customerLastReadAt: input.now }
        : { customerUnreadCount: { increment: 1 }, storeUnreadCount: 0, storeLastReadAt: input.now }),
    },
  });
  await notifyOtherSide(tx, { ...input, recipient: fromCustomer ? "STORE" : "CUSTOMER" });
  return message;
}

/** Link-only e-mail to the other side, at most one per conversation, side and 15 minutes (outbox dedupe). */
async function notifyOtherSide(tx: Tx, input: { conversationId: string; storeId: string; customerId: string; recipient: MessageSenderRoleValue; now: Date; appBaseUrl?: string }) {
  const store = await tx.store.findUnique({ where: { id: input.storeId }, select: { name: true, contactEmail: true, vendor: { select: { user: { select: { email: true, isActive: true } } } } } });
  if (!store) return;
  if (input.recipient === "STORE") {
    // Owner decision: the store's notification address, falling back to the seller account e-mail.
    const recipient = store.contactEmail || (store.vendor?.user?.isActive ? store.vendor.user.email : null);
    if (!recipient) return;
    await enqueueEmail(tx, {
      eventKey: messageEmailEventKey(input.conversationId, "STORE", input.now),
      recipient,
      template: "MESSAGE_TO_STORE",
      payload: { storeName: store.name, url: appLink(input.appBaseUrl, `/vendor/${encodeURIComponent(input.storeId)}/messages/${encodeURIComponent(input.conversationId)}`) },
    });
    return;
  }
  const customer = await tx.user.findUnique({ where: { id: input.customerId }, select: { email: true, isActive: true } });
  if (!customer?.isActive) return;
  await enqueueEmail(tx, {
    eventKey: messageEmailEventKey(input.conversationId, "CUSTOMER", input.now),
    recipient: customer.email,
    template: "MESSAGE_TO_CUSTOMER",
    payload: { storeName: store.name, url: appLink(input.appBaseUrl, `/account/messages/${encodeURIComponent(input.conversationId)}`) },
  });
}

// ---- Customer starts (or continues) a conversation ------------------------------------------------------------

export type StartInput = { customerId: string; storeId: string; context: ConversationContextValue; contextId?: string | null; body: unknown };

/**
 * A customer writes to a store about a product, one of their store orders, or the store in general. If the thread for
 * this context already exists the message is added to it (one thread per customer, store and context).
 */
export async function startConversation(db: Db, input: StartInput, ctx: MessagingContext) {
  requireEnabled(ctx);
  const body = cleanBody(input.body, ctx);
  const now = ctx.now?.() ?? new Date();
  const customer = await db.user.findUnique({ where: { id: input.customerId }, select: { role: true, isActive: true } });
  if (!customer || customer.role !== "CUSTOMER" || !customer.isActive) fail("NOT_FOUND", MESSAGING_TEXT.storeUnavailable);
  if (!(await storeAcceptsMessages(db, input.storeId, now))) fail("STORE_UNAVAILABLE", MESSAGING_TEXT.storeUnavailable);

  let contextKey: string;
  try { contextKey = conversationContextKey(input.context, input.contextId); } catch { return fail("CONTEXT_INVALID", MESSAGING_TEXT.storeUnavailable); }
  let productId: string | null = null;
  let storeOrderId: string | null = null;
  if (input.context === "PRODUCT") {
    const product = await db.product.findFirst({ where: { id: input.contextId!, storeId: input.storeId, status: "ACTIVE" }, select: { id: true } });
    if (!product) fail("CONTEXT_INVALID", MESSAGING_TEXT.storeUnavailable);
    productId = product!.id;
  } else if (input.context === "ORDER") {
    // Only the customer who owns this store order, and only this store's part of the order.
    const storeOrder = await db.storeOrder.findFirst({ where: { id: input.contextId!, storeId: input.storeId, order: { userId: input.customerId } }, select: { id: true } });
    if (!storeOrder) fail("CONTEXT_INVALID", MESSAGING_TEXT.storeUnavailable);
    storeOrderId = storeOrder!.id;
  }
  if (await isBlocked(db, input.storeId, input.customerId)) fail("BLOCKED", MESSAGING_TEXT.blocked);

  const existing = await db.conversation.findUnique({ where: { customerId_storeId_contextKey: { customerId: input.customerId, storeId: input.storeId, contextKey } }, select: { id: true } });
  if (existing) {
    const sent = await sendMessage(db, { conversationId: existing.id, actor: { role: "CUSTOMER", userId: input.customerId }, body }, ctx);
    return { conversationId: existing.id, messageId: sent.messageId, created: false };
  }
  await consumeLimits(ctx, [
    [`customer-new:${input.customerId}`, ctx.settings.limits.customerNewConversationsPerDay, MESSAGING_WINDOWS.customerNewConversationsPerDay],
    [`customer:${input.customerId}`, ctx.settings.limits.customerMessagesPerHour, MESSAGING_WINDOWS.customerMessagesPerHour],
    [`store-in:${input.storeId}`, ctx.settings.limits.storeIncomingPerHour, MESSAGING_WINDOWS.storeIncomingPerHour],
  ]);
  try {
    return await db.$transaction(async (tx) => {
      const conversation = await tx.conversation.create({
        data: {
          storeId: input.storeId, customerId: input.customerId, context: input.context, contextKey, productId, storeOrderId,
          lastMessageAt: now, lastMessagePreview: messagePreview(body), lastSenderRole: "CUSTOMER", createdAt: now,
        },
        select: { id: true },
      });
      await lockConversation(tx, conversation.id);
      const message = await appendMessage(tx, { conversationId: conversation.id, storeId: input.storeId, customerId: input.customerId, sender: { role: "CUSTOMER", userId: input.customerId }, body, now, appBaseUrl: ctx.appBaseUrl });
      return { conversationId: conversation.id, messageId: message.id, created: true };
    });
  } catch (error) {
    // Two tabs started the same thread at once: the unique key let one in; add this message to that thread.
    if ((error as { code?: string })?.code !== "P2002") throw error;
    const winner = await db.conversation.findUnique({ where: { customerId_storeId_contextKey: { customerId: input.customerId, storeId: input.storeId, contextKey } }, select: { id: true } });
    if (!winner) throw error;
    const sent = await sendMessageLocked(db, { conversationId: winner.id, actor: { role: "CUSTOMER", userId: input.customerId }, body, clock: () => ctx.now?.() ?? new Date(), appBaseUrl: ctx.appBaseUrl });
    return { conversationId: winner.id, messageId: sent.messageId, created: false };
  }
}

// ---- Send a message in an existing conversation ---------------------------------------------------------------

/**
 * The conversation if it belongs to this customer or this store, else null (the routes answer 404). A conversation
 * whose customer account was deleted (customerId NULL, kept only because it had an OPEN report) belongs to nobody but
 * admin: it is null here for both sides, so every send, read, poll, block and report refuses it.
 */
async function loadOwned(db: Db | Tx, conversationId: string, actor: MessagingActor) {
  const conversation = await db.conversation.findUnique({ where: { id: conversationId }, select: { id: true, storeId: true, customerId: true } });
  if (!conversation || conversation.customerId === null) return null;
  if (actor.role === "CUSTOMER" ? conversation.customerId !== actor.userId : conversation.storeId !== actor.storeId) return null;
  return { id: conversation.id, storeId: conversation.storeId, customerId: conversation.customerId };
}

export async function sendMessage(db: Db, input: { conversationId: string; actor: MessagingActor; body: unknown }, ctx: MessagingContext) {
  requireEnabled(ctx);
  const body = cleanBody(input.body, ctx);
  const now = ctx.now?.() ?? new Date();
  const conversation = await loadOwned(db, input.conversationId, input.actor);
  if (!conversation) fail("NOT_FOUND", MESSAGING_TEXT.storeUnavailable);
  if (input.actor.role === "CUSTOMER" && !(await storeAcceptsMessages(db, conversation!.storeId, now))) fail("STORE_UNAVAILABLE", MESSAGING_TEXT.storeUnavailable);
  if (await isBlocked(db, conversation!.storeId, conversation!.customerId)) fail("BLOCKED", MESSAGING_TEXT.blocked);
  await consumeLimits(ctx, input.actor.role === "CUSTOMER"
    ? [
      [`customer:${input.actor.userId}`, ctx.settings.limits.customerMessagesPerHour, MESSAGING_WINDOWS.customerMessagesPerHour],
      [`store-in:${conversation!.storeId}`, ctx.settings.limits.storeIncomingPerHour, MESSAGING_WINDOWS.storeIncomingPerHour],
    ]
    : [[`store-out:${conversation!.storeId}`, ctx.settings.limits.storeMessagesPerHour, MESSAGING_WINDOWS.storeMessagesPerHour]]);
  return sendMessageLocked(db, { conversationId: conversation!.id, actor: input.actor, body, clock: () => ctx.now?.() ?? new Date(), appBaseUrl: ctx.appBaseUrl });
}

/**
 * The timestamp is taken AFTER the lock: messages and read times of one conversation are then ordered exactly like the
 * lock order, so "unread = the other side's messages after my last read" holds and polling by time never misses one.
 */
async function sendMessageLocked(db: Db, input: { conversationId: string; actor: MessagingActor; body: string; clock: () => Date; appBaseUrl?: string }) {
  return db.$transaction(async (tx) => {
    await lockConversation(tx, input.conversationId);
    const now = input.clock();
    const conversation = await loadOwned(tx, input.conversationId, input.actor);
    if (!conversation) fail("NOT_FOUND", MESSAGING_TEXT.storeUnavailable);
    // Re-checked under the lock: a block that committed a moment ago wins.
    if (await isBlocked(tx, conversation!.storeId, conversation!.customerId)) fail("BLOCKED", MESSAGING_TEXT.blocked);
    const message = await appendMessage(tx, { conversationId: conversation!.id, storeId: conversation!.storeId, customerId: conversation!.customerId, sender: input.actor, body: input.body, now, appBaseUrl: input.appBaseUrl });
    return { conversationId: conversation!.id, messageId: message.id };
  });
}

// ---- Read state, lists, messages ------------------------------------------------------------------------------

/** The actor has read the thread: their unread counter becomes 0. Works while messaging is off (reading is harmless). */
export async function markConversationRead(db: Db, input: { conversationId: string; actor: MessagingActor }, ctx: Pick<MessagingContext, "now"> = {}) {
  return db.$transaction(async (tx) => {
    await lockConversation(tx, input.conversationId);
    // Taken after the lock, like a send (see sendMessageLocked).
    const now = ctx.now?.() ?? new Date();
    const conversation = await loadOwned(tx, input.conversationId, input.actor);
    if (!conversation) fail("NOT_FOUND", MESSAGING_TEXT.storeUnavailable);
    await tx.conversation.update({
      where: { id: conversation!.id },
      data: input.actor.role === "CUSTOMER" ? { customerUnreadCount: 0, customerLastReadAt: now } : { storeUnreadCount: 0, storeLastReadAt: now },
    });
    return { conversationId: conversation!.id };
  });
}

/** Badge: number of this side's conversations with something unread (partial index on each side). */
export async function unreadConversationCount(db: Db, actor: MessagingActor) {
  return actor.role === "CUSTOMER"
    ? db.conversation.count({ where: { customerId: actor.userId, customerUnreadCount: { gt: 0 } } })
    : db.conversation.count({ where: { storeId: actor.storeId, customerId: { not: null }, storeUnreadCount: { gt: 0 } } });
}

type ListCursor = { lastMessageAt: Date; id: string };
export function encodeConversationCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.lastMessageAt.toISOString(), i: cursor.id })).toString("base64url");
}
export function decodeConversationCursor(value: string | null | undefined): ListCursor | null {
  if (!value || value.length > 200) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { t?: unknown; i?: unknown };
    const time = typeof parsed.t === "string" ? new Date(parsed.t) : null;
    if (!time || Number.isNaN(time.getTime()) || typeof parsed.i !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(parsed.i)) return null;
    return { lastMessageAt: time, id: parsed.i };
  } catch {
    return null;
  }
}

/**
 * Inbox page, newest activity first (index on side + lastMessageAt + id). The store sees a customer display name
 * only; the customer sees the store name. No e-mail or phone in the result.
 */
export async function listConversations(db: Db, input: { actor: MessagingActor; cursor?: string | null; limit?: number }) {
  const limit = Math.min(Math.max(input.limit ?? MESSAGE_LIMITS.inboxPageSize, 1), 50);
  const cursor = decodeConversationCursor(input.cursor);
  // Orphans (customerId NULL) never appear on either side: the customer side matches its own id, the store side excludes NULL.
  const side: Prisma.ConversationWhereInput = input.actor.role === "CUSTOMER" ? { customerId: input.actor.userId } : { storeId: input.actor.storeId, customerId: { not: null } };
  const rows = await db.conversation.findMany({
    where: { AND: [side, ...(cursor ? [{ OR: [{ lastMessageAt: { lt: cursor.lastMessageAt } }, { lastMessageAt: cursor.lastMessageAt, id: { lt: cursor.id } }] }] : [])] },
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true, context: true, lastMessageAt: true, lastMessagePreview: true, lastSenderRole: true, customerUnreadCount: true, storeUnreadCount: true,
      store: { select: { id: true, name: true } },
      customer: { select: { customerProfile: { select: { firstName: true, lastName: true } } } },
      product: { select: { id: true, name: true } },
      storeOrder: { select: { id: true, orderId: true } },
    },
  });
  const page = rows.slice(0, limit);
  return {
    items: page.map((row) => ({
      id: row.id,
      context: row.context,
      counterpart: input.actor.role === "CUSTOMER" ? row.store.name : customerDisplayName(row.customer?.customerProfile?.firstName, row.customer?.customerProfile?.lastName),
      storeId: row.store.id,
      product: row.product ? { id: row.product.id, name: row.product.name } : null,
      orderRef: row.storeOrder ? row.storeOrder.orderId.slice(-8).toUpperCase() : null,
      lastMessageAt: row.lastMessageAt,
      lastMessagePreview: row.lastMessagePreview,
      lastSenderRole: row.lastSenderRole,
      unread: input.actor.role === "CUSTOMER" ? row.customerUnreadCount : row.storeUnreadCount,
    })),
    nextCursor: rows.length > limit ? encodeConversationCursor(page[page.length - 1]) : null,
  };
}

/**
 * Messages of one thread for its customer or its store: the newest page, older pages (before), or only new ones
 * since a message (after; for polling). Sender is a role, never an e-mail or phone.
 */
export async function listMessages(db: Db, input: { conversationId: string; actor: MessagingActor; before?: string | null; after?: string | null; limit?: number }) {
  const conversation = await loadOwned(db, input.conversationId, input.actor);
  if (!conversation) fail("NOT_FOUND", MESSAGING_TEXT.storeUnavailable);
  const limit = Math.min(Math.max(input.limit ?? MESSAGE_LIMITS.pageSize, 1), 100);
  const anchorId = input.after ?? input.before ?? null;
  const anchor = anchorId ? await db.conversationMessage.findFirst({ where: { id: anchorId, conversationId: conversation!.id }, select: { id: true, createdAt: true } }) : null;
  if (anchorId && !anchor) fail("INVALID", MESSAGING_TEXT.storeUnavailable);
  const select = { id: true, senderRole: true, body: true, createdAt: true } as const;
  if (input.after && anchor) {
    const items = await db.conversationMessage.findMany({
      where: { conversationId: conversation!.id, OR: [{ createdAt: { gt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { gt: anchor.id } }] },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit, select,
    });
    return { items, hasOlder: null as boolean | null };
  }
  const rows = await db.conversationMessage.findMany({
    where: { conversationId: conversation!.id, ...(anchor ? { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, select,
  });
  return { items: rows.slice(0, limit).reverse(), hasOlder: rows.length > limit };
}

// ---- Block, unblock, report -----------------------------------------------------------------------------------

/** The actor's side blocks the other side for this store (all their conversations). Idempotent. */
export async function blockCounterpart(db: Db, input: { conversationId: string; actor: MessagingActor }) {
  const conversation = await loadOwned(db, input.conversationId, input.actor);
  if (!conversation) fail("NOT_FOUND", MESSAGING_TEXT.storeUnavailable);
  await db.$transaction(async (tx) => {
    await lockConversation(tx, conversation!.id);
    await tx.conversationBlock.upsert({
      where: { storeId_customerId_side: { storeId: conversation!.storeId, customerId: conversation!.customerId, side: input.actor.role } },
      create: { storeId: conversation!.storeId, customerId: conversation!.customerId, side: input.actor.role, createdById: input.actor.userId },
      update: {},
    });
  });
  return { blocked: true };
}

/** Removes only the actor's own side's block; the other side's block stays. */
export async function unblockCounterpart(db: Db, input: { conversationId: string; actor: MessagingActor }) {
  const conversation = await loadOwned(db, input.conversationId, input.actor);
  if (!conversation) fail("NOT_FOUND", MESSAGING_TEXT.storeUnavailable);
  await db.conversationBlock.deleteMany({ where: { storeId: conversation!.storeId, customerId: conversation!.customerId, side: input.actor.role } });
  return { blocked: await isBlocked(db, conversation!.storeId, conversation!.customerId) };
}

/** Either side reports the conversation; one open report per conversation and side. The other side is not told. */
export async function reportConversation(db: Db, input: { conversationId: string; actor: MessagingActor; reason: ReportReason | string; note?: string | null }) {
  if (!isReportReason(input.reason)) fail("INVALID", MESSAGING_TEXT.storeUnavailable);
  const note = input.note?.trim() || null;
  if (note && note.length > MESSAGE_LIMITS.reportNoteMax) fail("INVALID", MESSAGING_TEXT.storeUnavailable);
  const conversation = await loadOwned(db, input.conversationId, input.actor);
  if (!conversation) fail("NOT_FOUND", MESSAGING_TEXT.storeUnavailable);
  return db.$transaction(async (tx) => {
    await lockConversation(tx, conversation!.id);
    const open = await tx.conversationReport.findFirst({ where: { conversationId: conversation!.id, reporterRole: input.actor.role, status: "OPEN" }, select: { id: true } });
    if (open) return { id: open.id, created: false };
    const report = await tx.conversationReport.create({
      data: { conversationId: conversation!.id, reporterUserId: input.actor.userId, reporterRole: input.actor.role, reason: input.reason as string, note },
      select: { id: true },
    });
    return { id: report.id, created: true };
  });
}

// ---- Customer account deletion ---------------------------------------------------------------------------------

/**
 * Account deletion rule (owner decision 2026-11-17). Any flow that deletes a customer account must call this inside
 * the same transaction, BEFORE deleting the User row:
 *
 * 1. the customer's conversations WITHOUT an OPEN report are deleted (their messages and reports go with them);
 * 2. conversations WITH an OPEN report stay; deleting the User row then sets their customerId to NULL
 *    (FK ON DELETE SET NULL). Such orphans are readable by admin only, through their report (lib/messaging-admin.ts);
 *    stores and customers never see them (loadOwned, listConversations, unreadConversationCount, getConversationView).
 * 3. blocks (ConversationBlock) cascade with the User row.
 *
 * A user deleted without this helper keeps ALL of their conversations as admin-only orphans (nothing is lost).
 */
export async function deleteCustomerConversations(tx: Pick<Db, "conversation"> | Tx, userId: string) {
  const deleted = await tx.conversation.deleteMany({ where: { customerId: userId, reports: { none: { status: "OPEN" } } } });
  const kept = await tx.conversation.count({ where: { customerId: userId } });
  return { deleted: deleted.count, kept };
}
