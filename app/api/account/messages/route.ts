import { customerActor, listAction, messagingRoute, startAction } from "@/lib/messaging-routes";

export const dynamic = "force-dynamic";

/** Customer inbox (cursor pages) and "write to the store" (product, order or store-general thread). */
export const GET = messagingRoute(customerActor, listAction, { write: false });
export const POST = messagingRoute(customerActor, startAction, { write: true });
