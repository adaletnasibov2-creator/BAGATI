import { customerActor, messagesAction, messagingRoute, sendAction } from "@/lib/messaging-routes";

export const dynamic = "force-dynamic";

/** Messages of the customer's own thread (?before= older page, ?after= polling with 204) and replies. */
export const GET = messagingRoute(customerActor, messagesAction, { write: false });
export const POST = messagingRoute(customerActor, sendAction, { write: true });
