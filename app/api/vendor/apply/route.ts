import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueEmail } from "@/lib/email-outbox";

const schema = z.object({
  displayName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(5).max(40).optional().nullable(),
  sellerType: z.enum(["INDIVIDUAL_ENTREPRENEUR", "REGISTERED_COMPANY"]),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.role !== "CUSTOMER") return NextResponse.json({ error: "Satıcı müraciəti üçün müştəri hesabına daxil olun." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Sorğu məlumatları düzgün deyil." }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Məlumatları yoxlayın.", details: parsed.error.flatten() }, { status: 422 });

  try {
    const profile = await prisma.$transaction(async (tx) => {
      const existing = await tx.vendorProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
      if (existing) throw new Error("SELLER_PROFILE_EXISTS");
      const updatedUser = await tx.user.updateMany({ where: { id: user.id, role: "CUSTOMER", isActive: true }, data: { role: "VENDOR" } });
      if (!updatedUser.count) throw new Error("ACCOUNT_CHANGED");
      const created = await tx.vendorProfile.create({
        data: { userId: user.id, displayName: parsed.data.displayName, phone: parsed.data.phone || null, sellerType: parsed.data.sellerType },
        select: { id: true },
      });
      await tx.auditLog.create({ data: { actorId: user.id, action: "SELLER_APPLICATION", entityType: "VendorProfile", entityId: created.id, metadata: { sellerType: parsed.data.sellerType } } });
      const account = await tx.user.findUnique({ where: { id: user.id }, select: { email: true } });
      if (!account) throw new Error("ACCOUNT_CHANGED");
      await enqueueEmail(tx, { eventKey: `seller-application:${created.id}`, recipient: account.email, template: "SELLER_APPLICATION_SUBMITTED", payload: { displayName: parsed.data.displayName } });
      return created;
    });
    return NextResponse.json({ profile, message: "Satıcı profili yaradıldı. Mağaza qaralamasını ayrıca yarada bilərsiniz." }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "SELLER_PROFILE_EXISTS") return NextResponse.json({ error: "Satıcı profili artıq mövcuddur." }, { status: 409 });
    if (error instanceof Error && error.message === "ACCOUNT_CHANGED") return NextResponse.json({ error: "Hesabın statusu dəyişib. Səhifəni yeniləyin." }, { status: 409 });
    return NextResponse.json({ error: "Satıcı müraciətini yaratmaq mümkün olmadı." }, { status: 500 });
  }
}
