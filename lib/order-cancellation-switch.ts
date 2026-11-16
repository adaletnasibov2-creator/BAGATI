/**
 * Master switch for customer order cancellation: admin setting "orders.customerCancellationEnabled" (default OFF,
 * owner decision 2026-11-16). Read through the cached settings path (30 s, fail-safe: a failed read gives the code
 * default, i.e. OFF). Server-only.
 *
 * OFF: the customer order page renders no cancellation panel, and the direct-cancel and cancellation-request routes
 * answer 403 CUSTOMER_CANCELLATION_DISABLED before touching the order. NOT affected: the store's decision on a request
 * that already exists, store and admin cancels, returns, the "cancelled order cannot start a payment" guard and the
 * "late PAID on a cancelled order" refund-needed listing.
 * ON: the rules in lib/order-cancellation.ts apply unchanged.
 */
import { NextResponse } from "next/server";
import { getSetting } from "@/lib/settings/read";
import { SETTING_KEYS } from "@/lib/settings/registry";

export const CUSTOMER_CANCELLATION_DISABLED_CODE = "CUSTOMER_CANCELLATION_DISABLED";
export const CUSTOMER_CANCELLATION_DISABLED_MESSAGE = "Hazırda sifarişi sayt üzərindən ləğv etmək mümkün deyil. Sualınız olarsa, mağaza ilə əlaqə saxlayın.";

type SettingReader = (key: string) => Promise<unknown>;
const cachedRead: SettingReader = (key) => getSetting<boolean>(key);

/** True only when the admin switched the feature on; any other value (unset, failed read) means OFF. */
export async function isCustomerCancellationEnabled(read: SettingReader = cachedRead): Promise<boolean> {
  return (await read(SETTING_KEYS.ordersCustomerCancellationEnabled)) === true;
}

/** null when the feature is on; otherwise the 403 the customer routes return. */
export async function customerCancellationGate(read: SettingReader = cachedRead): Promise<NextResponse | null> {
  if (await isCustomerCancellationEnabled(read)) return null;
  return NextResponse.json({ error: CUSTOMER_CANCELLATION_DISABLED_MESSAGE, code: CUSTOMER_CANCELLATION_DISABLED_CODE }, { status: 403 });
}
