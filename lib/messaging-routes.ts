/**
 * The messaging route handlers (phase 5 customer, phase 6 seller). Route files only pick an actor resolver and an
 * action; every request goes through `runMessagingRoute`:
 *
 *   1. writes: same-origin check (csrfRejection, also done by the middleware for /api/*)
 *   2. actor: requireRole("CUSTOMER") or requireStoreAccess(storeId)  -> 401 / 404
 *   3. messaging switch (cached setting)                               -> 403 MESSAGING_DISABLED while OFF
 *   4. ids, JSON body (4 KB cap), service call                         -> 404 for anything not the caller's own
 *
 * The seller's actor always carries the storeId returned by requireStoreAccess, never the raw URL value.
 */
import { requireRole, requireStoreAccess } from "@/lib/auth";
import { csrfRejection } from "@/lib/csrf";
import { isReportReason, MESSAGE_LIMITS } from "@/lib/messaging";
import {
  isMessagingId,
  messagingErrorResponse,
  messagingGate,
  messagingJson,
  messagingNoContent,
  messagingNotFound,
  messagingUnauthenticated,
  readMessagingBody,
} from "@/lib/messaging-http";
import {
  blockCounterpart,
  listConversations,
  listMessages,
  markConversationRead,
  reportConversation,
  sendMessage,
  startConversation,
  unblockCounterpart,
  type MessagingActor,
} from "@/lib/messaging-service";
import type { MessagingSettings } from "@/lib/messaging-settings";
import { prisma } from "@/lib/prisma";

type Params = Record<string, string | string[] | undefined>;
export type MessagingRouteContext = { params: Promise<Params> };
type Resolved = { actor: MessagingActor } | { response: Response };
type ActorResolver = (params: Params) => Promise<Resolved>;
type ActionInput = { request: Request; actor: MessagingActor; params: Params; settings: MessagingSettings };
type Action = (input: ActionInput) => Promise<Response>;

/** Customer routes: a signed-in, active CUSTOMER account (requireRole). */
export const customerActor: ActorResolver = async () => {
  const customer = await requireRole("CUSTOMER");
  if (!customer) return { response: messagingUnauthenticated() };
  return { actor: { role: "CUSTOMER", userId: customer.id } };
};

/** Seller routes: the signed-in seller owns this store (requireStoreAccess). Another store's id is 404. */
export const authorizeStoreActor: ActorResolver = async (params) => {
  const storeId = typeof params.storeId === "string" ? params.storeId : "";
  const access = isMessagingId(storeId) ? await requireStoreAccess(storeId) : null;
  if (access) return { actor: { role: "STORE", userId: access.user.id, storeId: access.storeId } };
  return { response: (await requireRole("VENDOR")) ? messagingNotFound() : messagingUnauthenticated() };
};

export async function runMessagingRoute(request: Request, context: MessagingRouteContext, resolveActor: ActorResolver, action: Action, options: { write: boolean }) {
  if (options.write) {
    const crossSite = csrfRejection(request);
    if (crossSite) return crossSite;
  }
  const params = await context.params;
  const resolved = await resolveActor(params);
  if ("response" in resolved) return resolved.response;
  const gate = await messagingGate();
  if ("response" in gate) return gate.response;
  return action({ request, actor: resolved.actor, params, settings: gate.settings });
}

/** Builds a route method: `export const POST = messagingRoute(customerActor, sendAction, { write: true })`. */
export function messagingRoute(resolveActor: ActorResolver, action: Action, options: { write: boolean }) {
  return (request: Request, context: MessagingRouteContext) => runMessagingRoute(request, context, resolveActor, action, options);
}

const appBaseUrl = () => process.env.APP_BASE_URL;
const queryValue = (request: Request, name: string) => {
  const value = new URL(request.url).searchParams.get(name);
  return value === null || value === "" ? null : value;
};

/** Runs an action on one conversation id from the URL; a malformed id is 404 like a foreign one. */
function onConversation(event: string, run: (input: ActionInput & { conversationId: string }) => Promise<Response>): Action {
  return async (input) => {
    const conversationId = input.params.conversationId;
    if (!isMessagingId(conversationId)) return messagingNotFound();
    try {
      return await run({ ...input, conversationId });
    } catch (error) {
      return messagingErrorResponse(error, event);
    }
  };
}

// ---- Actions ---------------------------------------------------------------------------------------------------

/** GET: inbox page (?cursor=). */
export const listAction: Action = async ({ request, actor }) => {
  try {
    return messagingJson(await listConversations(prisma, { actor, cursor: queryValue(request, "cursor") }));
  } catch (error) {
    return messagingErrorResponse(error, "list");
  }
};

/** POST (customer only): start a conversation, or add to the existing thread of the same context. */
export const startAction: Action = async ({ request, actor, settings }) => {
  if (actor.role !== "CUSTOMER") return messagingNotFound();
  const body = await readMessagingBody(request);
  if (!body.ok) return body.response;
  const { storeId, context, contextId, body: text } = body.value;
  if (!isMessagingId(storeId) || (context !== "PRODUCT" && context !== "ORDER" && context !== "STORE")) return messagingNotFound();
  if (context !== "STORE" && !isMessagingId(contextId)) return messagingNotFound();
  try {
    const result = await startConversation(
      prisma,
      { customerId: actor.userId, storeId, context, contextId: context === "STORE" ? null : (contextId as string), body: text },
      { settings, appBaseUrl: appBaseUrl() },
    );
    return messagingJson(result, result.created ? 201 : 200);
  } catch (error) {
    return messagingErrorResponse(error, "start");
  }
};

/** GET: messages of one thread. ?before=<id> for an older page; ?after=<id> for polling, 204 when nothing is new. */
export const messagesAction = onConversation("messages", async ({ request, actor, conversationId }) => {
  const after = queryValue(request, "after");
  const before = queryValue(request, "before");
  if ((after && !isMessagingId(after)) || (before && !isMessagingId(before)) || (after && before)) return messagingJson({ error: "Sorğu məlumatı yanlışdır." }, 400);
  const result = await listMessages(prisma, { conversationId, actor, after, before });
  if (after && result.items.length === 0) return messagingNoContent();
  return messagingJson(result);
});

/** POST: send a message in an existing thread. */
export const sendAction = onConversation("send", async ({ request, actor, settings, conversationId }) => {
  const body = await readMessagingBody(request);
  if (!body.ok) return body.response;
  const result = await sendMessage(prisma, { conversationId, actor, body: body.value.body }, { settings, appBaseUrl: appBaseUrl() });
  return messagingJson(result, 201);
});

/** POST: the caller has read the thread (their unread counter becomes 0). */
export const readAction = onConversation("read", async ({ actor, conversationId }) => {
  return messagingJson(await markConversationRead(prisma, { conversationId, actor }));
});

/** POST: block the other side (for this store); DELETE: lift the caller's own block. */
export const blockAction = onConversation("block", async ({ actor, conversationId }) => messagingJson(await blockCounterpart(prisma, { conversationId, actor })));
export const unblockAction = onConversation("unblock", async ({ actor, conversationId }) => messagingJson(await unblockCounterpart(prisma, { conversationId, actor })));

/** POST: report the conversation (reason + optional note). The other side is not told. */
export const reportAction = onConversation("report", async ({ request, actor, conversationId }) => {
  const body = await readMessagingBody(request);
  if (!body.ok) return body.response;
  const { reason, note } = body.value;
  if (!isReportReason(reason)) return messagingJson({ error: "Şikayətin səbəbini seçin." }, 422);
  if (note !== undefined && note !== null && (typeof note !== "string" || note.trim().length > MESSAGE_LIMITS.reportNoteMax)) {
    return messagingJson({ error: `Qeyd ən çox ${MESSAGE_LIMITS.reportNoteMax} simvol ola bilər.` }, 422);
  }
  const result = await reportConversation(prisma, { conversationId, actor, reason, note: (note as string | null | undefined) ?? null });
  return messagingJson(result, result.created ? 201 : 200);
});
