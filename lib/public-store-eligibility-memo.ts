/**
 * CLEANUP-2: read store-eligibility data once per request.
 *
 * Before, a public page could read the same store rows twice in one request: the product page in generateMetadata and
 * again in the page; the product list / search page in the store-filter scan and again inside the product scan (the
 * product candidates loaded their store's eligibility fields as a nested select). Each read is about 7 SQL statements
 * (Store, City, VendorProfile, User, StoreSubscription, SubscriptionPlan, StoreComplimentaryEntitlement).
 *
 * The memo keeps the store ROWS (the fields isPublicStoreEligible reads), not yes/no answers: every caller still runs
 * isPublicStoreEligible on the same data with its own `now`, so the rules and the result are unchanged. Only ids not
 * seen yet are read, with the same query as resolvePublicStoreEligibility (loadPublicStoreCandidates).
 *
 * Request scope: requestPublicStoreEligibility() is wrapped in React cache(), so one server-component request
 * (page + generateMetadata) shares one memo and nothing is kept between requests. Not for route handlers or
 * transactions (cache() does not apply there; use resolvePublicStoreEligibility with the transaction client).
 */
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import {
  isPublicStoreEligible,
  loadPublicStoreCandidates,
  type PublicStoreCandidate,
  type PublicStoreEligibilityClient,
} from "@/lib/public-store-eligibility";

export type PublicStoreEligibilityMemo = {
  /** Wraps a read that already returns full store candidate rows (the store-filter scan): its rows are remembered,
   * and load() waits for it before reading ids it does not know yet. */
  track<R extends readonly PublicStoreCandidate[]>(read: Promise<R>): Promise<R>;
  /** Store rows by id; ids not seen yet are read once (unknown ids are left out, as in resolvePublicStoreEligibility). */
  load(storeIds: readonly string[]): Promise<Map<string, PublicStoreCandidate>>;
  /** Same result as resolvePublicStoreEligibility(storeIds, client, now), from remembered rows where possible. */
  resolve(storeIds: readonly string[], now: Date): Promise<Set<string>>;
};

export function createPublicStoreEligibilityMemo(client: PublicStoreEligibilityClient): PublicStoreEligibilityMemo {
  const rows = new Map<string, PublicStoreCandidate>();
  const tracked = new Set<Promise<unknown>>();
  const reading = new Map<string, Promise<void>>();

  const remember = (candidates: readonly PublicStoreCandidate[]) => {
    for (const candidate of candidates) if (!rows.has(candidate.id)) rows.set(candidate.id, candidate);
  };

  const track: PublicStoreEligibilityMemo["track"] = (read) => {
    const remembered = read.then((candidates) => { remember(candidates); return candidates; });
    tracked.add(remembered);
    remembered.then(() => tracked.delete(remembered), () => tracked.delete(remembered));
    return remembered;
  };

  const load: PublicStoreEligibilityMemo["load"] = async (storeIds) => {
    // A tracked read that is still running may already bring these stores: wait for it (its failure is its caller's).
    if (tracked.size) await Promise.allSettled([...tracked]);
    const uniqueIds = [...new Set(storeIds)];
    const missing = uniqueIds.filter((id) => !rows.has(id) && !reading.has(id));
    if (missing.length) {
      const read = loadPublicStoreCandidates(missing, client).then(remember);
      read.then(() => undefined, () => undefined).finally(() => { for (const id of missing) reading.delete(id); });
      for (const id of missing) reading.set(id, read);
    }
    await Promise.all(uniqueIds.flatMap((id) => reading.get(id) ?? []));
    const found = new Map<string, PublicStoreCandidate>();
    for (const id of uniqueIds) {
      const row = rows.get(id);
      if (row) found.set(id, row);
    }
    return found;
  };

  const resolve: PublicStoreEligibilityMemo["resolve"] = async (storeIds, now) => {
    const eligible = new Set<string>();
    for (const [id, candidate] of await load(storeIds)) if (isPublicStoreEligible(candidate, now)) eligible.add(id);
    return eligible;
  };

  return { track, load, resolve };
}

/** One memo per server-component request (React cache): the page and its generateMetadata share it. */
export const requestPublicStoreEligibility = cache((): PublicStoreEligibilityMemo => createPublicStoreEligibilityMemo(prisma));
