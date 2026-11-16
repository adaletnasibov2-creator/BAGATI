/**
 * Page guards and badges for the messaging screens. Server-only. While messaging.enabled is OFF every messaging page
 * is a 404 and every badge / menu entry is hidden (null).
 */
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { loadMessagingSettings, type MessagingSettings } from "@/lib/messaging-settings";
import { unreadConversationCount } from "@/lib/messaging-service";
import { prisma } from "@/lib/prisma";
import { messageEntryHref } from "@/lib/messaging-client";

/** A customer messaging page: signed-in customer (else login and back), messaging ON (else 404). */
export async function requireCustomerMessagingPage(nextPath: string) {
  const user = await currentUser();
  if (!user || user.role !== "CUSTOMER") redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  const settings = await loadMessagingSettings();
  if (!settings.enabled) notFound();
  return { user, settings };
}

/** A seller messaging page after requireVendorStorePage: messaging ON, else 404. */
export async function requireStoreMessagingEnabled(): Promise<MessagingSettings> {
  const settings = await loadMessagingSettings();
  if (!settings.enabled) notFound();
  return settings;
}

/**
 * "Mesajlarım" badge: null when messaging is OFF (the entry is hidden), else the number of the customer's
 * conversations with something unread. Never throws (a failed count shows the entry without a number).
 */
export async function customerMessagesBadge(userId: string): Promise<number | null> {
  const settings = await loadMessagingSettings();
  if (!settings.enabled) return null;
  return unreadConversationCount(prisma, { role: "CUSTOMER", userId }).catch(() => 0);
}

/** "Söhbətlər" badge in the vendor panel: null when OFF (tab hidden), else conversations with unread messages. */
export async function storeConversationsBadge(storeId: string, userId: string): Promise<number | null> {
  const settings = await loadMessagingSettings();
  if (!settings.enabled) return null;
  return unreadConversationCount(prisma, { role: "STORE", userId, storeId }).catch(() => 0);
}

/** Entry button target for the current viewer, or null (messaging OFF, seller/admin, or hidden for logged-out). */
export async function messageEntryForViewer(target: { storeId: string; productId?: string | null; storeOrderId?: string | null }, loggedOut: "login" | "hide"): Promise<string | null> {
  const settings = await loadMessagingSettings();
  if (!settings.enabled) return null;
  const user = await currentUser();
  return messageEntryHref(user?.role ?? null, target, loggedOut);
}
