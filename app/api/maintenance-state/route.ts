import { NextResponse } from "next/server";
import { getSetting } from "@/lib/settings/read";
import { MAINTENANCE_MESSAGE_DEFAULT, SETTING_KEYS } from "@/lib/settings/registry";

export const dynamic = "force-dynamic";

/**
 * Maintenance state for the Edge middleware (lib/maintenance-state.ts). Public: the message is shown to every
 * visitor anyway, and nothing else is returned. Settings engine 30 s cache, fail-safe (defaults: off).
 */
export async function GET() {
  const [enabled, message] = await Promise.all([
    getSetting<boolean>(SETTING_KEYS.maintenanceEnabled),
    getSetting<string>(SETTING_KEYS.maintenanceMessage),
  ]);
  return NextResponse.json({ enabled: enabled === true, message: message || MAINTENANCE_MESSAGE_DEFAULT }, { headers: { "Cache-Control": "no-store" } });
}
