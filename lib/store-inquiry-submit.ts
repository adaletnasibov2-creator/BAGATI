import type { PrismaClient } from "@prisma/client";
import { normalizeAzPhone } from "@/lib/az-phone";
import { enqueueEmail } from "@/lib/email-outbox";
import { resolvePublicStoreEligibility, type PublicStoreEligibilityClient } from "@/lib/public-store-eligibility";
import type { StoreInquiryInput } from "@/lib/store-inquiry";

export type SubmitStoreInquiryResult =
  | { kind: "NOT_FOUND" }
  | { kind: "CREATED"; id: string; emailQueued: boolean };

/** Absolute vendor inbox link for the notification, only for a well-formed http(s) APP_BASE_URL. */
export function vendorInboxUrl(appBaseUrl: string | undefined, storeId: string): string | null {
  if (!appBaseUrl) return null;
  try {
    const base = new URL(appBaseUrl);
    if (base.protocol !== "https:" && base.protocol !== "http:") return null;
    return `${base.origin}/vendor/${encodeURIComponent(storeId)}/inquiries`;
  } catch {
    return null;
  }
}

/**
 * Saves a buyer message for a publicly visible store and, when the store has a notification email,
 * queues it through the email outbox in the same transaction. Works without SMTP: the message is
 * stored and visible in the vendor inbox whether or not the email is ever delivered.
 * Rate limiting and the honeypot are handled by the caller before this runs.
 */
export async function submitStoreInquiry(
  db: Pick<PrismaClient, "$transaction" | "store">,
  input: { storeId: string; data: StoreInquiryInput; ipHash: string | null; appBaseUrl?: string },
): Promise<SubmitStoreInquiryResult> {
  const eligible = await resolvePublicStoreEligibility([input.storeId], db as unknown as PublicStoreEligibilityClient);
  if (!eligible.has(input.storeId)) return { kind: "NOT_FOUND" };
  const store = await db.store.findUnique({ where: { id: input.storeId }, select: { id: true, name: true, contactEmail: true } });
  if (!store) return { kind: "NOT_FOUND" };

  return db.$transaction(async (tx) => {
    const inquiry = await tx.storeInquiry.create({
      data: {
        storeId: store.id,
        name: input.data.name,
        contactEmail: input.data.contactEmail,
        contactPhone: input.data.contactPhone,
        message: input.data.message,
        ipHash: input.ipHash,
      },
      select: { id: true },
    });
    let emailQueued = false;
    if (store.contactEmail) {
      await enqueueEmail(tx, {
        eventKey: `store-inquiry:${inquiry.id}`,
        recipient: store.contactEmail,
        template: "STORE_INQUIRY",
        payload: {
          storeName: store.name,
          senderName: input.data.name,
          senderEmail: input.data.contactEmail,
          senderPhone: input.data.contactPhone ? normalizeAzPhone(input.data.contactPhone)?.display ?? input.data.contactPhone : null,
          message: input.data.message,
          inboxUrl: vendorInboxUrl(input.appBaseUrl, store.id),
        },
      });
      emailQueued = true;
    }
    return { kind: "CREATED" as const, id: inquiry.id, emailQueued };
  });
}
