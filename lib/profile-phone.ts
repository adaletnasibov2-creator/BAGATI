/**
 * SIGNUP-EASY-1 R4: when a customer saves a delivery address at checkout and their profile has no phone yet, the
 * address phone is copied into CustomerProfile.phone. An existing profile phone is never overwritten.
 *
 * PHONE-REQUIRED-1: after a successful order the order phone (already a valid mobile number, +994XXXXXXXXX) is saved
 * to the profile when the profile phone is empty OR not a valid Azerbaijani mobile number. A valid one is kept.
 */
import { Prisma } from "@prisma/client";
import { normalizeAzMobilePhone } from "@/lib/az-phone";

type ProfileWriter = Pick<Prisma.TransactionClient, "customerProfile">;

/**
 * CLEANUP-1 (L3): the phone sent to PATCH /api/account/profile, checked with the SAME validator as orders
 * (normalizeAzMobilePhone). Not sent: undefined (the saved phone is kept). Empty: "" (still allowed, as before).
 * A valid Azerbaijani mobile number: its +994XXXXXXXXX form (the format orders store). Anything else: null (refused).
 */
export function profilePhoneInput(phone: string | undefined): string | undefined | null {
  if (phone === undefined) return undefined;
  const value = phone.trim();
  if (!value) return "";
  return normalizeAzMobilePhone(value);
}

export async function rememberProfilePhoneIfEmpty(db: ProfileWriter, userId: string, phone: string): Promise<"saved" | "kept" | "created"> {
  const value = phone.trim().slice(0, 30);
  if (!value) return "kept";
  // Only rows whose phone is still empty are updated, so a phone saved meanwhile is never replaced.
  const updated = await db.customerProfile.updateMany({ where: { userId, OR: [{ phone: null }, { phone: "" }] }, data: { phone: value } });
  if (updated.count) return "saved";
  const existing = await db.customerProfile.findUnique({ where: { userId }, select: { id: true } });
  if (existing) return "kept";
  return createProfileWithPhone(db, userId, value);
}

/** PHONE-REQUIRED-1: called after the order commit, best-effort (the caller catches). */
export async function rememberOrderPhone(db: ProfileWriter, userId: string, phone: string): Promise<"saved" | "kept" | "created"> {
  const value = normalizeAzMobilePhone(phone);
  if (!value) return "kept";
  const existing = await db.customerProfile.findUnique({ where: { userId }, select: { phone: true } });
  if (!existing) return createProfileWithPhone(db, userId, value);
  if (normalizeAzMobilePhone(existing.phone)) return "kept";
  // Compare-and-set on the value just read: a phone saved meanwhile is never replaced.
  const updated = await db.customerProfile.updateMany({ where: { userId, phone: existing.phone }, data: { phone: value } });
  return updated.count ? "saved" : "kept";
}

async function createProfileWithPhone(db: ProfileWriter, userId: string, phone: string): Promise<"created" | "kept"> {
  try {
    await db.customerProfile.create({ data: { userId, phone } });
    return "created";
  } catch (error) {
    // A profile created at the same moment (unique userId): keep whatever it has.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "kept";
    throw error;
  }
}
