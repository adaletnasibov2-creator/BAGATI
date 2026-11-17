import { blockAction, messagingRoute, authorizeStoreActor, unblockAction } from "@/lib/messaging-routes";

export const dynamic = "force-dynamic";

/** The store blocks this customer (POST) or lifts its own block (DELETE). */
export const POST = messagingRoute(authorizeStoreActor, blockAction, { write: true });
export const DELETE = messagingRoute(authorizeStoreActor, unblockAction, { write: true });
