import { Prisma } from "@prisma/client";
import { readSettingInTransaction } from "@/lib/settings/read";
import { SETTING_KEYS } from "@/lib/settings/registry";

/**
 * Commission rate to snapshot on each new StoreOrder, read INSIDE the order transaction:
 *   the store's own rule in force at `at` (newest start wins) ?? the default commission setting ?? null.
 * The default is read uncached from SiteSetting, so an order never uses a value older than its own creation.
 * The result is stored once in StoreOrder.commissionRateSnapshot and never recomputed: changing a store rule or the
 * default affects only orders created afterwards. Existing NULL snapshots are never backfilled.
 */
export async function commissionRatesForNewOrder(tx: Prisma.TransactionClient, storeIds: string[], at: Date): Promise<Map<string, Prisma.Decimal | null>> {
  const rules = await tx.commission.findMany({
    where: { storeId: { in: storeIds }, startsAt: { lte: at }, OR: [{ endsAt: null }, { endsAt: { gt: at } }] },
    orderBy: { startsAt: "desc" },
    select: { storeId: true, rate: true },
  });
  const storeRate = new Map<string, Prisma.Decimal>();
  for (const rule of rules) if (!storeRate.has(rule.storeId)) storeRate.set(rule.storeId, rule.rate);
  const defaultRate = await readSettingInTransaction<string>(tx, SETTING_KEYS.commissionDefaultRate);
  const fallback = defaultRate === null ? null : new Prisma.Decimal(defaultRate);
  return new Map(storeIds.map((storeId) => [storeId, storeRate.get(storeId) ?? fallback]));
}
