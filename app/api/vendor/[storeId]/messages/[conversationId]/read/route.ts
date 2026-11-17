import { messagingRoute, readAction, authorizeStoreActor } from "@/lib/messaging-routes";

export const dynamic = "force-dynamic";

export const POST = messagingRoute(authorizeStoreActor, readAction, { write: true });
