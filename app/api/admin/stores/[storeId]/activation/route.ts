import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { adminStoreVisibilityMutation, type StoreWorkflowStatus } from "@/lib/store-visibility";
import { getStorePublicationBlockers, publishEligibleDraftProducts } from "@/lib/admin-store-product-publishing";
import { resolveStoreEntitlements } from "@/lib/subscription-entitlements";

const requestSchema = z.object({ isActive: z.boolean(), reason: z.string().trim().min(3).max(500) });

export async function PATCH(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });

  const { storeId } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(storeId)) {
    return NextResponse.json({ error: "Mağaza identifikatoru yanlışdır" }, { status: 422 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Aktivlik statusunu yoxlayın" }, { status: 422 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Store" WHERE "id" = ${storeId} FOR UPDATE`;
      const store = await tx.store.findUnique({
        where: { id: storeId },
        select: {
          id: true,
          status: true,
          isActive: true,
          legalInfoApproved: true,
          adminManaged: true,
          vendor: {
            select: {
              sellerType: true,
              legalName: true,
              voen: true,
              legalAddress: true,
              user: { select: { isActive: true } },
            },
          },
          city: { select: { isActive: true } },
          subscription: {
            select: {
              status: true,
              currentPeriodStart: true,
              currentPeriodEnd: true,
              plan: { select: { slug: true, isActive: true } },
            },
          },
        },
      });
      if (!store) return { kind: "NOT_FOUND" as const };
      const visibilityUpdate = adminStoreVisibilityMutation(store.status as StoreWorkflowStatus, parsed.data.isActive);
      if (!visibilityUpdate) return { kind: "NOT_APPROVED" as const, status: store.status };
      if (store.isActive === visibilityUpdate.isActive) {
        if (!parsed.data.isActive) return { kind: "UNCHANGED" as const, isActive: store.isActive };
      }

      const changedVisibility = store.isActive !== visibilityUpdate.isActive;
      if (changedVisibility) {
        await tx.store.update({ where: { id: store.id }, data: visibilityUpdate, select: { id: true } });
        await tx.auditLog.create({
          data: {
            actorId: admin.id,
            action: parsed.data.isActive ? "STORE_ACTIVATE" : "STORE_DEACTIVATE",
            entityType: "Store",
            entityId: store.id,
            metadata: {
              previousStatus: store.status,
              nextStatus: store.status,
              previousIsActive: store.isActive,
              nextIsActive: visibilityUpdate.isActive,
              reason: parsed.data.reason || null,
              legalInfoApproved: store.legalInfoApproved,
              adminManaged: store.adminManaged,
              subscriptionStatus: store.subscription?.status ?? null,
              eligibleDraftPublicationAttempted: parsed.data.isActive,
            },
          },
        });
      }

      const publicationState = {
        status: store.status,
        isActive: visibilityUpdate.isActive,
        legalInfoApproved: store.legalInfoApproved,
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
      };
      const storeBlockers = getStorePublicationBlockers(publicationState);
      const entitlement = resolveStoreEntitlements({
        adminManaged: publicationState.adminManaged,
        storeStatus: publicationState.status,
        storeActive: publicationState.isActive,
        vendorActive: publicationState.vendorActive,
        cityActive: publicationState.cityActive,
        subscriptionStatus: publicationState.subscriptionStatus,
        planSlug: publicationState.planSlug,
        planActive: publicationState.planActive,
        periodStart: publicationState.periodStart,
        periodEnd: publicationState.periodEnd,
      });
      const products = parsed.data.isActive
        ? await publishEligibleDraftProducts(tx, {
          storeId: store.id,
          actorId: admin.id,
          plan: storeBlockers.length ? null : entitlement.plan,
          storeBlockers,
          reason: parsed.data.reason,
        })
        : null;
      return {
        kind: changedVisibility ? "UPDATED" as const : "UNCHANGED" as const,
        isActive: visibilityUpdate.isActive,
        status: store.status,
        products,
        storeBlockers,
      };
    });

    if (result.kind === "NOT_FOUND") return NextResponse.json({ error: "Mağaza tapılmadı" }, { status: 404 });
    if (result.kind === "NOT_APPROVED") return NextResponse.json({ error: "İctimai görünürlükdən əvvəl mağaza admin yoxlamasından keçməli və ACTIVE statusu almalıdır." }, { status: 409 });
    if (result.kind === "UNCHANGED" && !result.products) return NextResponse.json({ item: { isActive: result.isActive }, message: "Mağaza statusu dəyişməyib." });
    const published = result.products?.published.length ?? 0;
    const skipped = result.products?.skipped.length ?? 0;
    return NextResponse.json({
      item: { isActive: result.isActive, status: result.status },
      message: result.isActive
        ? `Mağazanın ictimai görünürlüğü aktivdir. ${published} qaralama məhsul yayımlandı; ${skipped} məhsul səbəblərinə görə qaralama qaldı.`
        : "Mağazanın ictimai görünürlüğü deaktiv edildi.",
      products: result.products,
      activationBlockers: result.storeBlockers,
    });
  } catch {
    return NextResponse.json({ error: "Mağazanın statusunu saxlamaq mümkün olmadı." }, { status: 500 });
  }
}
