/**
 * SIGNUP-EASY-1 R4: when a customer saves a delivery address at checkout and their profile has no phone yet, the
 * address phone is copied into CustomerProfile.phone. An existing profile phone is never overwritten.
 */
import { Prisma } from "@prisma/client";

type ProfileWriter = Pick<Prisma.TransactionClient, "customerProfile">;

export async function rememberProfilePhoneIfEmpty(db: ProfileWriter, userId: string, phone: string): Promise<"saved" | "kept" | "created"> {
  const value = phone.trim().slice(0, 30);
  if (!value) return "kept";
  // Only rows whose phone is still empty are updated, so a phone saved meanwhile is never replaced.
  const updated = await db.customerProfile.updateMany({ where: { userId, OR: [{ phone: null }, { phone: "" }] }, data: { phone: value } });
  if (updated.count) return "saved";
  const existing = await db.customerProfile.findUnique({ where: { userId }, select: { id: true } });
  if (existing) return "kept";
  try {
    await db.customerProfile.create({ data: { userId, phone: value } });
    return "created";
  } catch (error) {
    // A profile created at the same moment (unique userId): keep whatever it has.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "kept";
    throw error;
  }
}
