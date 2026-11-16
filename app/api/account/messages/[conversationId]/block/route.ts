import { blockAction, customerActor, messagingRoute, unblockAction } from "@/lib/messaging-routes";

export const dynamic = "force-dynamic";

/** The customer blocks this store (POST) or lifts their own block (DELETE). */
export const POST = messagingRoute(customerActor, blockAction, { write: true });
export const DELETE = messagingRoute(customerActor, unblockAction, { write: true });
