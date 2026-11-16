import { listAction, messagingRoute, authorizeStoreActor } from "@/lib/messaging-routes";

export const dynamic = "force-dynamic";

/** Seller inbox ("Söhbətlər") of this store only (requireStoreAccess); the store never starts a conversation. */
export const GET = messagingRoute(authorizeStoreActor, listAction, { write: false });
