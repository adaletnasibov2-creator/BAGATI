import { messagingRoute, reportAction, authorizeStoreActor } from "@/lib/messaging-routes";

export const dynamic = "force-dynamic";

export const POST = messagingRoute(authorizeStoreActor, reportAction, { write: true });
