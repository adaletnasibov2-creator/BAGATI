import { customerActor, messagingRoute, readAction } from "@/lib/messaging-routes";

export const dynamic = "force-dynamic";

export const POST = messagingRoute(customerActor, readAction, { write: true });
