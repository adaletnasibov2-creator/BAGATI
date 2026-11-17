import { customerActor, messagingRoute, reportAction } from "@/lib/messaging-routes";

export const dynamic = "force-dynamic";

export const POST = messagingRoute(customerActor, reportAction, { write: true });
