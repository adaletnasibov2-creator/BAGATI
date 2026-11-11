import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorePublicationBlockers, publishEligibleDraftProducts } from "@/lib/admin-store-product-publishing";
import { resolveStoreEntitlements } from "@/lib/subscription-entitlements";
import { missingSellerLegalFields } from "@/lib/seller-legal-policy";
import { getStoreReviewUpdate, type StoreReviewStatus } from "@/lib/store-review";
import { enqueueEmail } from "@/lib/email-outbox";
import { storeReviewNotification } from "@/lib/vendor-notifications";

const schema = z.object({
  action: z.enum(["approve", "reject", "suspend", "reactivate"]),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "Bu əməliyyat üçün admin icazəsi tələb olunur." }, { status: 403 });
  const { storeId } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(storeId)) return NextResponse.json({ error: "Mağaza identifikatoru yanlışdır." }, { status: 422 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Sorğu məlumatları düzgün deyil." }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Qərar məlumatlarını yoxlayın." }, { status: 422 });
  if ((parsed.data.action === "reject" || parsed.data.action === "suspend") && !parsed.data.reason?.trim()) {
    return NextResponse.json({ error: "Rədd etmə və ya dayandırma səbəbini qeyd edin." }, { status: 422 });
  }

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Store" WHERE "id" = ${storeId} FOR UPDATE`;
      const store = await tx.store.findUnique({
        where: { id: storeId },
        select: {
          id: true, name: true, status: true, isActive: true, legalInfoApproved: true, adminManaged: true,
          city: { select: { isActive: true } },
          subscription: {
            select: {
              status: true, currentPeriodStart: true, currentPeriodEnd: true,
              plan: { select: { slug: true, isActive: true } },
            },
          },
          vendor: {
            select: {
              sellerType: true, legalName: true, voen: true, legalAddress: true,
              user: { select: { id: true, email: true, isActive: true } },
            },
          },
        },
      });
      if (!store) return { kind: "NOT_FOUND" as const };

      const missing = missingSellerLegalFields(store.vendor);
      const decision = getStoreReviewUpdate(
        parsed.data.action,
        store.status as StoreReviewStatus,
        missing.length === 0,
        parsed.data.reason,
      );
      if (!decision.ok) return { kind: "INVALID_DECISION" as const, error: decision.error, missing };

      const activating = parsed.data.action === "approve" || parsed.data.action === "reactivate";
      const candidateState = activating ? {
        status: decision.update.status,
        isActive: true,
        legalInfoApproved: decision.update.legalInfoApproved,
        adminManaged: store.adminManaged,
        vendorActive: store.vendor.user.isActive,
        cityActive: store.city.isActive,
        sellerType: store.vendor.sellerType,
        legalName: store.vendor.legalName,
        voen: store.vendor.voen,
        legalAddress: store.vendor.legalAddress,
        subscriptionStatus: store.subscription?.status ?? null,
        planSlug: store.subscription?.plan.slug ?? null,
        planActive: store.subscription?.plan.isActive ?? false,
        periodStart: store.subscription?.currentPeriodStart ?? null,
        periodEnd: store.subscription?.currentPeriodEnd ?? null,
      } : null;
      const activationBlockers = candidateState ? getStorePublicationBlockers(candidateState) : [];
      const update = activating
        ? { ...decision.update, isActive: activationBlockers.length === 0 }
        : decision.update;

      const changed = await tx.store.updateMany({
        where: { id: store.id, status: store.status, isActive: store.isActive },
        data: update,
      });
      if (!changed.count) return { kind: "CONFLICT" as const };

      const audit = await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: decision.auditAction,
          entityType: "Store",
          entityId: store.id,
          metadata: {
            previousStatus: store.status,
            nextStatus: update.status,
            previousIsActive: store.isActive,
            nextIsActive: update.isActive,
            reason: update.reviewNote,
            legalInformationComplete: missing.length === 0,
            activationBlockers,
          },
        },
        select: { id: true },
      });
      await enqueueEmail(tx, {
        eventKey: `store-review:${audit.id}`,
        recipient: store.vendor.user.email,
        template: "STORE_REVIEW",
        payload: { storeName: store.name, status: update.status, reason: update.reviewNote ?? "" },
      });
      // Seller in-app notification (additive; same transaction as the decision, so it cannot be duplicated or orphaned).
      const sellerNotice = storeReviewNotification(decision.auditAction, store.name, update.reviewNote, update.isActive);
      if (sellerNotice) await tx.notification.create({ data: { userId: store.vendor.user.id, storeId: store.id, ...sellerNotice } });

      const products = activating
        ? await publishEligibleDraftProducts(tx, {
          storeId: store.id,
          actorId: admin.id,
          plan: candidateState && !activationBlockers.length
            ? resolveStoreEntitlements({
              adminManaged: candidateState.adminManaged,
              storeStatus: candidateState.status,
              storeActive: candidateState.isActive,
              vendorActive: candidateState.vendorActive,
              cityActive: candidateState.cityActive,
              subscriptionStatus: candidateState.subscriptionStatus,
              planSlug: candidateState.planSlug,
              planActive: candidateState.planActive,
              periodStart: candidateState.periodStart,
              periodEnd: candidateState.periodEnd,
            }).plan
            : null,
          storeBlockers: activationBlockers,
          reason: parsed.data.reason,
        })
        : null;
      const item = await tx.store.findUnique({
        where: { id: store.id },
        select: { id: true, status: true, isActive: true, legalInfoApproved: true, reviewNote: true },
      });
      return { kind: "UPDATED" as const, item, activationBlockers, products, action: decision.auditAction, adminManaged: store.adminManaged };
    }, { isolationLevel: "Serializable" });

    if (outcome.kind === "NOT_FOUND") return NextResponse.json({ error: "Mağaza tapılmadı." }, { status: 404 });
    if (outcome.kind === "CONFLICT") return NextResponse.json({ error: "Mağazanın statusu dəyişib. Səhifəni yeniləyin." }, { status: 409 });
    if (outcome.kind === "INVALID_DECISION") {
      if (outcome.error === "LEGAL_INFORMATION_INCOMPLETE") {
        return NextResponse.json({
          error: `Təsdiqdən əvvəl hüquqi məlumatları tamamlayın: ${outcome.missing.join(", ") || "Satıcı növü"}.`,
          missingFields: outcome.missing,
        }, { status: 422 });
      }
      if (outcome.error === "REASON_REQUIRED") return NextResponse.json({ error: "Qərar səbəbini daxil edin." }, { status: 422 });
      return NextResponse.json({ error: "Bu statusda seçilmiş qərar mümkün deyil." }, { status: 409 });
    }

    const message = outcome.action === "STORE_REJECT"
      ? "Mağaza müraciəti rədd edildi."
      : outcome.action === "STORE_SUSPEND"
        ? "Mağaza dayandırıldı."
        : outcome.item?.isActive
          ? `Mağaza aktivləşdirildi. ${outcome.products?.published.length ?? 0} qaralama məhsul yayımlandı; ${outcome.products?.skipped.length ?? 0} məhsul səbəblərinə görə qaralama qaldı.`
          : `Mağaza təsdiqləndi, lakin satış bağlı qaldı: ${outcome.activationBlockers.join(" ")}`;
    return NextResponse.json({
      item: outcome.item,
      message,
      activationBlockers: outcome.activationBlockers,
      products: outcome.products,
      adminManaged: outcome.adminManaged,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "STORE_STATUS_CHANGED") {
      return NextResponse.json({ error: "Mağazanın statusu dəyişib. Səhifəni yeniləyin." }, { status: 409 });
    }
    return NextResponse.json({ error: "Mağaza qərarını saxlamaq mümkün olmadı." }, { status: 500 });
  }
}
