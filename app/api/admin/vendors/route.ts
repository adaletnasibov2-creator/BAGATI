import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { adminCreateVendorSchema } from "@/lib/validation";
import { contactPhoneIssue } from "@/lib/az-phone";
import { enqueueVerificationEmail } from "@/lib/email-outbox";
import { isDuplicateEmailError } from "@/lib/registration-errors";
import {
  EMAIL_CODE_TTL_MS,
  generateVerificationCode,
  hashVerificationCode,
} from "@/lib/email-verification";

export const dynamic = "force-dynamic";

const db: any = prisma;
const slug = (text: string) =>
  text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "magaza";

/**
 * Admin creates a vendor account and its first store in a single committed
 * transaction. Reuses the existing self-registration password + email
 * verification flow so the new vendor works with the normal login/verify path.
 *
 * - ADMIN-only; no authorization from client-supplied ids.
 * - Password is hashed with bcrypt before persistence (never stored plaintext).
 * - Existing email is rejected (409) without creating a duplicate account.
 * - User, VendorProfile, EmailVerification, Store and audit log are created
 *   atomically; a failure anywhere rolls the whole creation back.
 * - Email verification is enqueued through the existing outbox; we do not claim
 *   the message was delivered (SMTP may be unconfigured locally).
 * - Store eligibility still requires legal approval + review + active city and
 *   vendor, so an approved-looking store never auto-opens public selling.
 */
export async function POST(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });

  let data: unknown;
  try {
    data = await request.json();
  } catch {
    return NextResponse.json({ error: "Sorğu məlumatları yanlışdır" }, { status: 400 });
  }

  const parsed = adminCreateVendorSchema.safeParse(data);
  if (!parsed.success) {
    return NextResponse.json({ error: contactPhoneIssue(parsed.error) ?? "Satıcı məlumatlarını yoxlayın", details: parsed.error.flatten() }, { status: 422 });
  }

  const values = parsed.data;
  const email = values.email.toLowerCase();
  const displayName = `${values.firstName} ${values.lastName}`.trim();

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return NextResponse.json({ error: "Bu e-poçt ünvanı artıq istifadə olunur" }, { status: 409 });
  }

  const city = await db.city.findFirst({ where: { id: values.cityId, isActive: true }, select: { id: true } });
  if (!city) {
    return NextResponse.json({ error: "Aktiv şəhər tapılmadı" }, { status: 422 });
  }

  const passwordHash = await bcrypt.hash(values.password, 12);
  const code = generateVerificationCode();
  const now = new Date();
  const codeHash = hashVerificationCode(code);
  const codeExpiresAt = new Date(now.getTime() + EMAIL_CODE_TTL_MS);

  const base = slug(values.storeName);
  const isActiveInitial = values.initialStatus === "PENDING_REVIEW";

  try {
    const created = await prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            role: "VENDOR",
            emailVerifiedAt: null,
            isActive: true,
            vendorProfile: {
              create: {
                displayName,
                phone: values.phone || null,
                sellerType: values.sellerType,
                legalName: values.legalName,
                voen: values.voen,
                legalAddress: values.legalAddress || null,
              },
            },
            emailVerification: {
              create: { codeHash, expiresAt: codeExpiresAt, lastSentAt: now, resendWindowStartedAt: now },
            },
          },
          select: { id: true, email: true, role: true, vendorProfile: { select: { id: true } } },
        });

        const vendorProfileId = user.vendorProfile?.id;
        if (!vendorProfileId) throw new Error("VendorProfile could not be created");

        const store = await tx.store.create({
          data: {
            vendorId: vendorProfileId,
            cityId: values.cityId,
            name: values.storeName,
            slug: `${base}-${crypto.randomUUID().slice(0, 8)}`,
            description: values.storeDescription || null,
            address: values.storeAddress || null,
            contactPhone: values.contactPhone || null,
            contactEmail: values.contactEmail || null,
            status: values.initialStatus,
            isActive: isActiveInitial,
            legalInfoApproved: false,
            adminManaged: values.adminManaged,
            managedByAdminId: values.adminManaged ? admin.id : null,
            managementReason: values.adminManaged ? values.managementReason : null,
          },
          select: { id: true, name: true, slug: true, status: true, isActive: true },
        });

        await enqueueVerificationEmail(tx, {
          userId: user.id,
          recipient: user.email,
          codeHash,
          code,
          expiresAt: codeExpiresAt,
        });

        await tx.auditLog.create({
          data: {
            actorId: admin.id,
            action: "ADMIN_VENDOR_CREATE",
            entityType: "Store",
            entityId: store.id,
            metadata: {
              vendorUserId: user.id,
              vendorProfileId,
              adminManaged: values.adminManaged,
              subscriptionPaymentRequired: !values.adminManaged,
              initialStatus: values.initialStatus,
              initiallyActive: isActiveInitial,
              internalNote: values.internalNote || null,
            },
          },
        });

        return { user, store };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return NextResponse.json(
      {
        item: created.store,
        vendorUserId: created.user.id,
        verificationRequired: true,
        message: values.adminManaged
          ? "Satıcı hesabı və admin-mağazası yaradıldı; abunəlik ödənişi tələb olunmur. Satış üçün hüquqi yoxlama və təsdiq tələb olunur."
          : "Satıcı hesabı və mağazası yaradıldı. İctimai satış üçün hüquqi təsdiq, yoxlama və aktiv abunəlik tələb olunur.",
      },
      { status: 201 },
    );
  } catch (error) {
    if (isDuplicateEmailError(error)) {
      return NextResponse.json({ error: "Bu e-poçt ünvanı artıq istifadə olunur" }, { status: 409 });
    }
    return NextResponse.json({ error: "Satıcı və mağaza yaradıla bilmədi. Məlumatlar saxlanılmadı." }, { status: 500 });
  }
}
