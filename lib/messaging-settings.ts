/**
 * Messaging settings through the cached, fail-safe settings path (30 s; a failed read gives the code defaults, i.e.
 * messaging OFF, contact details refused, the default limits). Server-only. The service (lib/messaging-service.ts)
 * receives these values as parameters, so its rules stay testable without the settings engine.
 */
import { getSetting } from "@/lib/settings/read";
import { SETTING_KEYS } from "@/lib/settings/registry";
import { MESSAGING_LIMIT_DEFAULTS, type MessagingLimits } from "@/lib/messaging";

export type MessagingSettings = { enabled: boolean; allowContactDetails: boolean; limits: MessagingLimits };
type SettingReader = (key: string) => Promise<unknown>;
const cachedRead: SettingReader = (key) => getSetting(key);

const positiveInteger = (value: unknown, fallback: number) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback);

export async function loadMessagingSettings(read: SettingReader = cachedRead): Promise<MessagingSettings> {
  const [enabled, allowContactDetails, customerMessagesPerHour, customerNewConversationsPerDay, storeMessagesPerHour, storeIncomingPerHour] = await Promise.all([
    read(SETTING_KEYS.messagingEnabled),
    read(SETTING_KEYS.messagingAllowContactDetails),
    read(SETTING_KEYS.messagingCustomerMessagesPerHour),
    read(SETTING_KEYS.messagingCustomerNewConversationsPerDay),
    read(SETTING_KEYS.messagingStoreMessagesPerHour),
    read(SETTING_KEYS.messagingStoreIncomingPerHour),
  ]);
  return {
    // Only a stored true switches a feature on; unset, failed or malformed values keep it off.
    enabled: enabled === true,
    allowContactDetails: allowContactDetails === true,
    limits: {
      customerMessagesPerHour: positiveInteger(customerMessagesPerHour, MESSAGING_LIMIT_DEFAULTS.customerMessagesPerHour),
      customerNewConversationsPerDay: positiveInteger(customerNewConversationsPerDay, MESSAGING_LIMIT_DEFAULTS.customerNewConversationsPerDay),
      storeMessagesPerHour: positiveInteger(storeMessagesPerHour, MESSAGING_LIMIT_DEFAULTS.storeMessagesPerHour),
      storeIncomingPerHour: positiveInteger(storeIncomingPerHour, MESSAGING_LIMIT_DEFAULTS.storeIncomingPerHour),
    },
  };
}
