import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSetting, readSettingInTransaction } from "@/lib/settings/read";
import { MAINTENANCE_MESSAGE_DEFAULT, SETTING_KEYS } from "@/lib/settings/registry";

export const dynamic = "force-dynamic";

/**
 * Maintenance state for the Edge middleware (lib/maintenance-state.ts). Public: the message is shown to every
 * visitor anyway, and nothing else is returned.
 *
 * MULTI-PROCESS-1: the ON/OFF flag is read UNCACHED (one primary-key read), so a switch made in one app process
 * reaches every process within the middleware's own cache (10 s while open, 1 s while ON) instead of also waiting for
 * the other processes' 30 s settings cache (up to ~40 s). If that read fails, the cached, fail-safe read is used, as
 * before (default: off). The message keeps the 30 s cached read (text only).
 */
export async function GET() {
  const [enabled, message] = await Promise.all([
    readMaintenanceEnabledUncached(),
    getSetting<string>(SETTING_KEYS.maintenanceMessage),
  ]);
  return NextResponse.json({ enabled: enabled === true, message: message || MAINTENANCE_MESSAGE_DEFAULT }, { headers: { "Cache-Control": "no-store" } });
}

async function readMaintenanceEnabledUncached(): Promise<boolean | null> {
  try {
    return await readSettingInTransaction<boolean>(prisma, SETTING_KEYS.maintenanceEnabled);
  } catch {
    return getSetting<boolean>(SETTING_KEYS.maintenanceEnabled);
  }
}
