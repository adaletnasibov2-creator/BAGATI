import { messagesAction, messagingRoute, sendAction, authorizeStoreActor } from "@/lib/messaging-routes";

export const dynamic = "force-dynamic";

/** Messages of one of this store's threads (?before=, ?after= with 204) and the store's replies. */
export const GET = messagingRoute(authorizeStoreActor, messagesAction, { write: false });
export const POST = messagingRoute(authorizeStoreActor, sendAction, { write: true });
