/**
 * Server-side loaders for the limit settings (30 s cache, fail-safe: any problem gives the code defaults).
 * Pure rule code (lib/seller-application.ts, lib/store-inquiry.ts) receives the numbers as parameters, so client
 * components keep importing only pure modules and never lib/settings.
 */
import { getSetting } from "@/lib/settings/read";
import { SETTING_KEYS } from "@/lib/settings/registry";
import { DEFAULT_SELLER_APPLICATION_LIMITS, type SellerApplicationLimits } from "@/lib/seller-application";
import { INQUIRY_IP_RATE_LIMIT, INQUIRY_STORE_RATE_LIMIT } from "@/lib/store-inquiry";

export type InquiryLimits = { perIpPerHour: number; perStorePerHour: number };

export async function loadSellerApplicationLimits(): Promise<SellerApplicationLimits> {
  const [reapplyWaitHours, maxPer30Days, perUserPerHour, perIpPerHour] = await Promise.all([
    getSetting<number>(SETTING_KEYS.sellerApplicationReapplyWaitHours),
    getSetting<number>(SETTING_KEYS.sellerApplicationMaxPer30Days),
    getSetting<number>(SETTING_KEYS.sellerApplicationPerUserPerHour),
    getSetting<number>(SETTING_KEYS.sellerApplicationPerIpPerHour),
  ]);
  return {
    reapplyWaitHours: reapplyWaitHours ?? DEFAULT_SELLER_APPLICATION_LIMITS.reapplyWaitHours,
    maxPer30Days: maxPer30Days ?? DEFAULT_SELLER_APPLICATION_LIMITS.maxPer30Days,
    perUserPerHour: perUserPerHour ?? DEFAULT_SELLER_APPLICATION_LIMITS.perUserPerHour,
    perIpPerHour: perIpPerHour ?? DEFAULT_SELLER_APPLICATION_LIMITS.perIpPerHour,
  };
}

export async function loadInquiryLimits(): Promise<InquiryLimits> {
  const [perIpPerHour, perStorePerHour] = await Promise.all([
    getSetting<number>(SETTING_KEYS.inquiryPerIpPerHour),
    getSetting<number>(SETTING_KEYS.inquiryPerStorePerHour),
  ]);
  return {
    perIpPerHour: perIpPerHour ?? INQUIRY_IP_RATE_LIMIT.limit,
    perStorePerHour: perStorePerHour ?? INQUIRY_STORE_RATE_LIMIT.limit,
  };
}
