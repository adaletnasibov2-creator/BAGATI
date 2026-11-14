import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueEmail } from "@/lib/email-outbox";
import { deliveryAmountSchema } from "@/lib/delivery";
import { OrderFulfillmentError, transitionAdminOrder } from "@/lib/order-fulfillment";
import { VENDOR_ORDER_STATUSES } from "@/lib/order-status";
import { resolvePublicStoreEligibility } from "@/lib/store-eligibility";
import { assertProductLimit, EntitlementError, entitlementErrorResponse, lockStoreEntitlement } from "@/lib/subscription-entitlements";
import { commissionRateInput, hasCommissionRuleConflict } from "@/lib/commission-rules";
import { logSecurityOperationFailure } from "@/lib/security-logging";
import { getProductPublicationBlockers } from "@/lib/admin-store-product-publishing";
import { supportedSubscriptionPlanSlugs } from "@/lib/subscription-plans";
import { saveManualSubscription } from "@/lib/admin-manual-subscription";
import { contactPhoneIssue, optionalAzPhoneSchema } from "@/lib/az-phone";
import { planStoreProfileUpdate } from "@/lib/admin-store-profile";

const db: any = prisma;
const storeStatuses = ["DRAFT", "PENDING_REVIEW", "ACTIVE", "SUSPENDED", "REJECTED"] as const;
const productStatuses = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
const ticketStatuses = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
const orderStatuses = ["PENDING", "NEW", "CONFIRMED", "PREPARING", "READY", "HANDED_TO_COURIER", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED"] as const;
const fulfillmentStatuses = VENDOR_ORDER_STATUSES;
const slug = (text: string) => text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const adminSubscriptionSchema = z.object({
  storeId: z.string().trim().min(1),
  planId: z.string().trim().min(1),
  status: z.enum(["PENDING", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED", "EXPIRED"]),
  currentPeriodStart: z.string().date(),
  currentPeriodEnd: z.string().date(),
  reason: z.string().trim().min(8).max(500),
}).refine((value) => value.currentPeriodStart < value.currentPeriodEnd, { path: ["currentPeriodEnd"], message: "Dövrün sonu başlanğıcdan sonra olmalıdır" });

async function audit(actorId: string, action: string, entityType: string, entityId: string, metadata?: unknown) {
  await db.auditLog.create({ data: { actorId, action, entityType, entityId, ...(metadata ? { metadata } : {}) } });
}

function createFailure(error: unknown, operation: string, conflictMessage: string) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return NextResponse.json({ error: conflictMessage }, { status: 409 });
  }
  logSecurityOperationFailure(operation, error);
  return NextResponse.json({ error: "Əməliyyat tamamlana bilmədi" }, { status: 503 });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ resource: string[] }> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const { resource } = await params;
  let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400 }); }
  const section = resource.join("/");
  if (section === "commissions") {
    // ratePercent (0–100, the admin form) or the older rate (0–1); see commissionRateInput.
    const rateInput = commissionRateInput(body);
    const parsed = z.object({ storeId: z.string().min(1), startsAt: z.coerce.date(), endsAt: z.coerce.date().nullable().optional() }).safeParse(body);
    if (!rateInput.ok || rateInput.rate === undefined || !parsed.success || (parsed.data.endsAt && parsed.data.endsAt <= parsed.data.startsAt)) return NextResponse.json({ error: "Komissiya tarix və faiz məlumatlarını yoxlayın" }, { status: 422 });
    if (!await db.store.findUnique({ where: { id: parsed.data.storeId }, select: { id: true } })) return NextResponse.json({ error: "Mağaza tapılmadı" }, { status: 422 });
    try {
      const result = await db.$transaction(async (tx: any) => {
        const existing = await tx.commission.findMany({ where: { storeId: parsed.data.storeId }, select: { startsAt: true, endsAt: true } });
        if (hasCommissionRuleConflict({ startsAt: parsed.data.startsAt, endsAt: parsed.data.endsAt || null }, existing)) return { conflict: true as const };
        const commission = await tx.commission.create({ data: { storeId: parsed.data.storeId, rate: rateInput.rate, startsAt: parsed.data.startsAt, endsAt: parsed.data.endsAt || null } });
        await tx.auditLog.create({ data: { actorId: admin.id, action: "COMMISSION_CREATE", entityType: "Commission", entityId: commission.id, metadata: { storeId: commission.storeId, rate: Number(commission.rate) } } });
        return { item: commission };
      }, { isolationLevel: "Serializable" });
      if ("conflict" in result) return NextResponse.json({ error: "Bu mağaza üçün həmin tarix aralığında komissiya qaydası mövcuddur" }, { status: 409 });
      return NextResponse.json({ item: result.item }, { status: 201 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return NextResponse.json({ error: "Komissiya qaydaları eyni vaxtda dəyişib; yenidən yoxlayın" }, { status: 409 });
      throw error;
    }
  }
  if (section === "categories") {
    const parsed = z.object({ name: z.string().trim().min(2).max(100), slug: z.string().trim().min(2).max(120).optional(), parentId: z.string().nullable().optional() }).safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Kateqoriya məlumatlarını yoxlayın" }, { status: 422 });
    if (parsed.data.parentId && !(await db.category.findUnique({ where: { id: parsed.data.parentId }, select: { id: true } }))) {
      return NextResponse.json({ error: "Üst kateqoriya tapılmadı" }, { status: 422 });
    }
    try { const item = await db.$transaction(async (tx: any) => { const created = await tx.category.create({ data: { name: parsed.data.name, slug: parsed.data.slug ? slug(parsed.data.slug) : slug(parsed.data.name), parentId: parsed.data.parentId || null } }); await tx.auditLog.create({ data: { actorId: admin.id, action: "CREATE", entityType: "Category", entityId: created.id } }); return created; }); return NextResponse.json({ item }, { status: 201 }); }
    catch (error) { return createFailure(error, "admin_category_create", "Kateqoriya adı və ya slug artıq mövcuddur"); }
  }
  if (section === "brands") {
    const parsed = z.object({ name: z.string().trim().min(2).max(100) }).safeParse(body); if (!parsed.success) return NextResponse.json({ error: "Brend adını yoxlayın" }, { status: 422 });
    try { const item = await db.$transaction(async (tx: any) => { const created = await tx.brand.create({ data: { name: parsed.data.name } }); await tx.auditLog.create({ data: { actorId: admin.id, action: "CREATE", entityType: "Brand", entityId: created.id } }); return created; }); return NextResponse.json({ item }, { status: 201 }); } catch (error) { return createFailure(error, "admin_brand_create", "Bu adda brend artıq mövcuddur"); }
  }
  if (section === "cities") {
    const parsed = z.object({ name: z.string().trim().min(2).max(100), slug: z.string().trim().min(2).max(120).optional(), countryCode: z.string().trim().length(2).default("AZ") }).safeParse(body); if (!parsed.success) return NextResponse.json({ error: "Şəhər məlumatlarını yoxlayın" }, { status: 422 });
    try { const item = await db.$transaction(async (tx: any) => { const created = await tx.city.create({ data: { name: parsed.data.name, slug: parsed.data.slug ? slug(parsed.data.slug) : slug(parsed.data.name), countryCode: parsed.data.countryCode.toUpperCase() } }); await tx.auditLog.create({ data: { actorId: admin.id, action: "CREATE", entityType: "City", entityId: created.id } }); return created; }); return NextResponse.json({ item }, { status: 201 }); } catch (error) { return createFailure(error, "admin_city_create", "Bu ad və ya slug artıq istifadə olunur"); }
  }
  if (section === "stores") {
    const parsed = z.object({ vendorId: z.string().min(1), cityId: z.string().min(1), name: z.string().trim().min(2).max(120), address: z.string().trim().max(300).nullable().optional(), description: z.string().max(3000).nullable().optional(), managementReason: z.string().trim().min(8).max(500), isActive: z.boolean().default(false) }).safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Mağaza məlumatlarını yoxlayın" }, { status: 422 });
    const [vendor, city] = await Promise.all([db.vendorProfile.findFirst({ where: { id: parsed.data.vendorId, user: { isActive: true } }, select: { id: true } }), db.city.findFirst({ where: { id: parsed.data.cityId, isActive: true }, select: { id: true } })]);
    if (!vendor || !city) return NextResponse.json({ error: "Satıcı və ya aktiv şəhər tapılmadı" }, { status: 422 });
    const base = slug(parsed.data.name) || "magaza";
    try { const item = await db.$transaction(async (tx: any) => { const store = await tx.store.create({ data: { vendorId: vendor.id, cityId: city.id, name: parsed.data.name, slug: `${base}-${crypto.randomUUID().slice(0, 8)}`, address: parsed.data.address || null, description: parsed.data.description || null, status: "DRAFT", isActive: parsed.data.isActive, adminManaged: true, managedByAdminId: admin.id, managementReason: parsed.data.managementReason }, select: { id: true, vendorId: true, cityId: true, name: true, status: true, isActive: true, adminManaged: true } }); await tx.auditLog.create({ data: { actorId: admin.id, action: "ADMIN_MANAGED_STORE_CREATE", entityType: "Store", entityId: store.id, metadata: { adminManaged: true, managementReason: parsed.data.managementReason, subscriptionPaymentRequired: false, initiallyActive: parsed.data.isActive } } }); return store; }); return NextResponse.json({ item, message: parsed.data.isActive ? "Ödənişsiz admin-mağaza qaralama kimi yaradıldı. Satış üçün hüquqi yoxlama və admin təsdiqi tələb olunur." : "Ödənişsiz admin-mağaza deaktiv qaralama kimi yaradıldı." }, { status: 201 }); } catch (error) { return createFailure(error, "admin_store_create", "Bu satıcı artıq mağaza ilə əlaqələndirilmiş ola bilər"); }
  }
  return NextResponse.json({ error: "Bu resurs üçün yaratma əməliyyatı yoxdur" }, { status: 404 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ resource: string[] }> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const { resource } = await params;
  let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400 }); }
  const section = resource.join("/");
  if (section === "subscriptions") {
    const parsed = adminSubscriptionSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Mağaza, plan, abunəlik dövrü və səbəbi yoxlayın.", details: parsed.error.flatten() }, { status: 422 });
    const periodStart = new Date(`${parsed.data.currentPeriodStart}T00:00:00.000Z`);
    const periodEnd = new Date(`${parsed.data.currentPeriodEnd}T00:00:00.000Z`);
    const now = new Date();
    if (parsed.data.status === "ACTIVE" && (periodStart > now || periodEnd <= now)) return NextResponse.json({ error: "Aktiv abunəlik dövrü bugünkü tarixi əhatə etməlidir." }, { status: 422 });
    try {
      const result = await db.$transaction((tx: any) => saveManualSubscription(tx, {
        storeId: parsed.data.storeId, planId: parsed.data.planId, status: parsed.data.status,
        periodStart, periodEnd, reason: parsed.data.reason, adminId: admin.id, now,
      }), { isolationLevel: "Serializable" });
      if ("missingStore" in result) return NextResponse.json({ error: "Mağaza tapılmadı." }, { status: 404 });
      if ("invalidPlan" in result) return NextResponse.json({ error: "Aktiv BASIC və ya PRO planı seçin." }, { status: 422 });
      return NextResponse.json({ item: result.item, complimentaryRevoked: result.complimentaryRevoked, message: `Admin tərəfindən verilən əl ilə giriş saxlanıldı. Ödəniş və ya ödəniş təsdiqi qeydə alınmayıb.${result.complimentaryRevoked ? " Ödənişsiz satış icazəsi ləğv edildi." : ""}` });
    } catch (error) {
      return createFailure(error, "admin_subscription_manual_change", "Abunəlik eyni vaxtda dəyişdirilib. Yenidən yükləyib təkrar edin.");
    }
  }
  const idSchema = z.object({ id: z.string().min(1) });
  const idResult = idSchema.safeParse(body); if (!idResult.success) return NextResponse.json({ error: "Qeyd identifikatoru yanlışdır" }, { status: 422 });
  const id = idResult.data.id;
  try {
    if (section === "stores") {
      if (body && typeof body === "object" && "status" in body) return NextResponse.json({ error: "Mağaza statusu yalnız admin yoxlama workflow-u ilə dəyişdirilə bilər." }, { status: 405 });
      const parsed = z.object({ id: z.string(), vendorId: z.string().optional(), expectedVendorId: z.string().optional(), expectedCityId: z.string().optional(), name: z.string().trim().min(2).max(120).optional(), cityId: z.string().optional(), logoUrl: z.string().url().max(1000).nullable().optional().refine((value) => !value || value.startsWith("https://")), description: z.string().max(3000).nullable().optional(), address: z.string().max(300).nullable().optional(), contactPhone: optionalAzPhoneSchema.optional(), contactEmail: z.string().email().nullable().optional(), latitude: z.number().finite().min(-90).max(90).nullable().optional(), longitude: z.number().finite().min(-180).max(180).nullable().optional(), mapUrl: z.string().url().nullable().optional(), freeDeliveryThreshold: deliveryAmountSchema.optional(), deliveryFee: deliveryAmountSchema.optional() }).safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: contactPhoneIssue(parsed.error) ?? "Mağaza məlumatlarını yoxlayın" }, { status: 422 });
      const { id: storeId, vendorId: requestedVendorId, cityId: requestedCityId, expectedVendorId, expectedCityId, ...values } = parsed.data;
      // Owner and city change only when the submitted value differs from the stored one (an unchanged value is not
      // an owner change: no legal re-review, no STORE_OWNER_CHANGE audit). A store changed meanwhile is refused.
      const currentStore = await db.store.findUnique({ where: { id: storeId }, select: { vendorId: true, cityId: true } });
      if (!currentStore) return NextResponse.json({ error: "Mağaza tapılmadı" }, { status: 404 });
      const plan = planStoreProfileUpdate(currentStore, { vendorId: requestedVendorId, cityId: requestedCityId, expectedVendorId, expectedCityId });
      if (!plan.ok) return NextResponse.json({ error: "Mağazanın sahibi və ya şəhəri başqa admin tərəfindən dəyişdirilib. Səhifəni yeniləyin." }, { status: 409 });
      const { vendorId, cityId } = plan;
      if ((values.latitude === null) !== (values.longitude === null) && (values.latitude !== undefined || values.longitude !== undefined)) return NextResponse.json({ error: "Koordinatlar birlikdə daxil edilməlidir" }, { status: 422 });
      if (cityId && !await db.city.findFirst({ where: { id: cityId, isActive: true }, select: { id: true } })) return NextResponse.json({ error: "Active city not found" }, { status: 422 });
      if (vendorId && !await db.vendorProfile.findFirst({ where: { id: vendorId, user: { isActive: true } }, select: { id: true } })) return NextResponse.json({ error: "Active vendor profile not found" }, { status: 422 });
      if (values.mapUrl && !values.mapUrl.startsWith("https://")) return NextResponse.json({ error: "Map URL must use HTTPS" }, { status: 422 });
      const item = await db.$transaction(async (tx: any) => { const updated = await tx.store.update({ where: { id: storeId, vendorId: currentStore.vendorId, cityId: currentStore.cityId }, data: { ...values, ...(cityId ? { cityId } : {}), ...(vendorId ? { vendorId, legalInfoApproved: false } : {}) }, select: { id: true, name: true, status: true, isActive: true, legalInfoApproved: true } }); await tx.auditLog.create({ data: { actorId: admin.id, action: vendorId ? "STORE_OWNER_CHANGE" : "UPDATE", entityType: "Store", entityId: updated.id, ...(vendorId ? { metadata: { vendorId, previousVendorId: currentStore.vendorId, legalReviewRequired: true } } : cityId ? { metadata: { cityId, previousCityId: currentStore.cityId } } : {}) } }); return updated; }); return NextResponse.json({ item });
    }
    if (section === "commissions") {
      const rateInput = commissionRateInput(body);
      const parsed = z.object({ id: z.string().min(1), storeId: z.string().min(1).optional(), startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().nullable().optional() }).safeParse(body);
      if (!rateInput.ok || !parsed.success) return NextResponse.json({ error: "Komissiya məlumatlarını yoxlayın" }, { status: 422 });
      const { id: commissionId, ...dates } = parsed.data;
      const values = { ...dates, ...(rateInput.rate === undefined ? {} : { rate: rateInput.rate }) };
      if (values.storeId && !await db.store.findUnique({ where: { id: values.storeId }, select: { id: true } })) return NextResponse.json({ error: "Mağaza tapılmadı" }, { status: 422 });
      const result = await db.$transaction(async (tx: any) => {
        const prior = await tx.commission.findUnique({ where: { id: commissionId } });
        if (!prior) return { missing: true as const };
        const startsAt = values.startsAt ?? prior.startsAt;
        const endsAt = values.endsAt === undefined ? prior.endsAt : values.endsAt;
        if (endsAt && endsAt <= startsAt) return { invalidRange: true as const };
        const storeId = values.storeId ?? prior.storeId;
        const existing = await tx.commission.findMany({ where: { storeId, id: { not: commissionId } }, select: { startsAt: true, endsAt: true } });
        if (hasCommissionRuleConflict({ startsAt, endsAt }, existing)) return { conflict: true as const };
        const updated = await tx.commission.update({ where: { id: commissionId }, data: values });
        await tx.auditLog.create({ data: { actorId: admin.id, action: "COMMISSION_UPDATE", entityType: "Commission", entityId: updated.id, metadata: { storeId: updated.storeId, rate: Number(updated.rate) } } });
        return { item: updated };
      }, { isolationLevel: "Serializable" });
      if ("missing" in result) return NextResponse.json({ error: "Komissiya qeydi tapılmadı" }, { status: 404 });
      if ("invalidRange" in result) return NextResponse.json({ error: "Son tarix başlanğıcdan sonra olmalıdır" }, { status: 422 });
      if ("conflict" in result) return NextResponse.json({ error: "Bu mağaza üçün həmin tarix aralığında komissiya qaydası mövcuddur" }, { status: 409 });
      return NextResponse.json({ item: result.item });
    }
    if (section === "subscriptions") {
      const parsed = z.object({ id: z.string().min(1), status: z.enum(["PENDING", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED", "EXPIRED"]) }).safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "Abunəlik statusunu yoxlayın" }, { status: 422 });
      const item = await db.$transaction(async (tx: any) => {
        const prior = await tx.storeSubscription.findUnique({ where: { id: parsed.data.id }, include: { plan: true, store: { select: { name: true, vendor: { select: { user: { select: { email: true } } } } } } } });
        if (!prior) return null;
        const updated = await tx.storeSubscription.update({ where: { id: parsed.data.id }, data: { status: parsed.data.status, ...(parsed.data.status === "ACTIVE" ? { startedAt: new Date(), currentPeriodStart: new Date(), currentPeriodEnd: new Date(new Date().setMonth(new Date().getMonth() + 1)), cancelledAt: null } : parsed.data.status === "CANCELLED" ? { cancelledAt: new Date() } : {}) }, include: { plan: true } });
        if (prior.status !== updated.status) {
          const auditRow = await tx.auditLog.create({ data: { actorId: admin.id, action: `SUBSCRIPTION_ADMIN_${parsed.data.status}`, entityType: "StoreSubscription", entityId: updated.id, metadata: { activationIsManual: parsed.data.status === "ACTIVE", paymentProvider: null } }, select: { id: true } });
          await enqueueEmail(tx, { eventKey: `subscription-status:${auditRow.id}`, recipient: prior.store.vendor.user.email, template: "SUBSCRIPTION_STATUS", payload: { storeName: prior.store.name, planName: prior.plan.name, status: updated.status } });
        }
        return updated;
      });
      if (!item) return NextResponse.json({ error: "Abunəlik tapılmadı" }, { status: 404 });
      return NextResponse.json({ item, message: parsed.data.status === "ACTIVE" ? "Admin tərəfindən əl ilə aktivləşdirildi; ödəniş provayderi təsdiqi deyil." : "Abunəlik statusu yeniləndi." });
    }
    if (section === "products") {
      const parsed = z.object({ id: z.string(), status: z.enum(productStatuses) }).safeParse(body); if (!parsed.success) return NextResponse.json({ error: "Məhsul statusunu yoxlayın" }, { status: 422 });
      const productStore = await db.product.findUnique({ where: { id }, select: { storeId: true } });
      if (!productStore) return NextResponse.json({ error: "Məhsul tapılmadı" }, { status: 404 });
      const outcome = await db.$transaction(async (tx: Prisma.TransactionClient) => {
        const entitlement = parsed.data.status === "ACTIVE"
          ? await lockStoreEntitlement(tx, productStore.storeId)
          : null;
        await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${id} FOR UPDATE`;
        const current = await tx.product.findUnique({
          where: { id },
          include: {
            category: { select: { isActive: true } },
            inventory: { select: { variantId: true, quantity: true, reserved: true } },
            variants: {
              select: {
                id: true, name: true, options: true, isActive: true, price: true, discountPrice: true,
                inventory: { select: { variantId: true, quantity: true, reserved: true } },
              },
            },
          },
        });
        if (!current || current.storeId !== productStore.storeId) return { kind: "NOT_FOUND" as const };
        if (parsed.data.status === "ACTIVE" && current.status !== "ACTIVE") {
          const productBlockers = getProductPublicationBlockers(current);
          if (productBlockers.length) return { kind: "PRODUCT_BLOCKED" as const, reasons: productBlockers };
          const eligibleStoreIds = await resolvePublicStoreEligibility([current.storeId], tx);
          if (!eligibleStoreIds.has(current.storeId)) return { kind: "STORE_INELIGIBLE" as const };
          if (!entitlement?.eligible || !entitlement.plan) throw new EntitlementError("SUBSCRIPTION_REQUIRED", null);
          await assertProductLimit(tx, current.storeId, entitlement.plan);
        }
        const changed = await tx.product.updateMany({ where: { id, storeId: current.storeId, status: current.status }, data: { status: parsed.data.status } });
        if (!changed.count) throw new Error("PRODUCT_STATUS_CHANGED");
        await tx.auditLog.create({ data: { actorId: admin.id, action: `PRODUCT_${parsed.data.status}`, entityType: "Product", entityId: id, metadata: { previousStatus: current.status, nextStatus: parsed.data.status } } });
        return { kind: "UPDATED" as const, item: await tx.product.findUnique({ where: { id }, select: { id: true, status: true } }) };
      });
      if (outcome.kind === "NOT_FOUND") return NextResponse.json({ error: "Məhsul tapılmadı" }, { status: 404 });
      if (outcome.kind === "PRODUCT_BLOCKED") return NextResponse.json({ error: "Məhsul yayımlanmaq üçün hazır deyil.", reasons: outcome.reasons }, { status: 422 });
      if (outcome.kind === "STORE_INELIGIBLE") return NextResponse.json({ error: "Məhsul yalnız təsdiqlənmiş, aktiv və satışa uyğun mağazada yayımlana bilər" }, { status: 409 });
      return NextResponse.json({ item: outcome.item });
    }
    if (section === "users") {
      const parsed = z.object({ id: z.string(), isActive: z.boolean() }).safeParse(body); if (!parsed.success) return NextResponse.json({ error: "İstifadəçi statusunu yoxlayın" }, { status: 422 });
      const item = await db.user.update({ where: { id, role: { in: ["CUSTOMER", "VENDOR"] } }, data: { isActive: parsed.data.isActive }, select: { id: true, isActive: true, role: true } }); await audit(admin.id, parsed.data.isActive ? "USER_ACTIVATE" : "USER_DEACTIVATE", "User", id); return NextResponse.json({ item });
    }
    if (section === "categories") {
      const parsed = z.object({ id: z.string(), name: z.string().trim().min(2).max(100).optional(), slug: z.string().trim().min(2).max(120).optional(), isActive: z.boolean().optional() }).safeParse(body); if (!parsed.success) return NextResponse.json({ error: "Kateqoriya məlumatlarını yoxlayın" }, { status: 422 }); const { id: categoryId, ...values } = parsed.data;
      const item = await db.category.update({ where: { id: categoryId }, data: { ...values, ...(values.slug ? { slug: slug(values.slug) } : {}) } }); await audit(admin.id, "UPDATE", "Category", id); return NextResponse.json({ item });
    }
    if (section === "brands") {
      const parsed = z.object({ id: z.string(), name: z.string().trim().min(2).max(100) }).safeParse(body); if (!parsed.success) return NextResponse.json({ error: "Brend məlumatını yoxlayın" }, { status: 422 }); const item = await db.brand.update({ where: { id }, data: { name: parsed.data.name } }); await audit(admin.id, "UPDATE", "Brand", id); return NextResponse.json({ item });
    }
    if (section === "cities") {
      const parsed = z.object({ id: z.string(), name: z.string().trim().min(2).max(100).optional(), slug: z.string().trim().min(2).max(120).optional(), countryCode: z.string().length(2).optional(), isActive: z.boolean().optional() }).safeParse(body); if (!parsed.success) return NextResponse.json({ error: "Şəhər məlumatlarını yoxlayın" }, { status: 422 }); const { id: cityId, ...values } = parsed.data; const item = await db.city.update({ where: { id: cityId }, data: { ...values, ...(values.slug ? { slug: slug(values.slug) } : {}) } }); await audit(admin.id, "UPDATE", "City", id); return NextResponse.json({ item });
    }
    if (section === "support") {
      const parsed = z.object({ id: z.string(), status: z.enum(ticketStatuses) }).safeParse(body); if (!parsed.success) return NextResponse.json({ error: "Müraciət statusunu yoxlayın" }, { status: 422 }); const item = await db.supportTicket.update({ where: { id }, data: { status: parsed.data.status } }); await audit(admin.id, `TICKET_${parsed.data.status}`, "SupportTicket", id); return NextResponse.json({ item });
    }
    if (section === "orders") {
      const parsed = z.object({ id: z.string().min(1), status: z.enum(fulfillmentStatuses) }).safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "Sifari\u015f statusunu yoxlay\u0131n" }, { status: 422 });
      const outcome = await db.$transaction(async (tx: any) => {
        const exists = await tx.order.findUnique({ where: { id: parsed.data.id }, select: { id: true, status: true, user: { select: { email: true } }, storeOrders: { select: { id: true, storeId: true, status: true, store: { select: { name: true, vendor: { select: { user: { select: { email: true } } } } } } } } } });
        if (!exists) return null;
        const order = await transitionAdminOrder(tx, { orderId: parsed.data.id, actorUserId: admin.id, targetStatus: parsed.data.status });
        if (exists.status !== order.status || exists.storeOrders.some((storeOrder: { status: string }) => storeOrder.status !== parsed.data.status)) {
          const auditRow = await tx.auditLog.create({ data: { actorId: admin.id, action: "ORDER_" + parsed.data.status, entityType: "Order", entityId: parsed.data.id }, select: { id: true } });
          await enqueueEmail(tx, { eventKey: "order-status:" + auditRow.id + ":customer", recipient: exists.user.email, template: "ORDER_STATUS", payload: { orderRef: order.id, storeName: "BAGATI", status: order.status } });
          for (const storeOrder of exists.storeOrders) await enqueueEmail(tx, { eventKey: "order-status:" + auditRow.id + ":" + storeOrder.id, recipient: storeOrder.store.vendor.user.email, template: "ORDER_STATUS", payload: { orderRef: order.id, storeName: storeOrder.store.name, status: order.status } });
        }
        return order;
      });
      if (!outcome) return NextResponse.json({ error: "Sifari\u015f tap\u0131lmad\u0131" }, { status: 404 });
      return NextResponse.json({ item: outcome });
    }
    return NextResponse.json({ error: "Bu resurs üçün yeniləmə əməliyyatı yoxdur" }, { status: 404 });
  } catch (error) {
    if (error instanceof EntitlementError) return entitlementErrorResponse(error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return NextResponse.json({ error: "Məlumat paralel dəyişib; yenidən yoxlayın" }, { status: 409 });
    if (error instanceof Error && error.message === "PRODUCT_STATUS_CHANGED") return NextResponse.json({ error: "Məhsulun statusu paralel dəyişdirildi. Səhifəni yeniləyin." }, { status: 409 });
    if (error instanceof OrderFulfillmentError) {
      const status = error.code === "NOT_FOUND" ? 404 : 409;
      const message = error.code === "PAYMENT_NOT_SETTLED" ? "\u00d6d\u0259ni\u015f t\u0259sdiql\u0259nm\u0259d\u0259n sifari\u015f \u00e7atd\u0131r\u0131lm\u0131\u015f kimi qeyd edil\u0259 bilm\u0259z" : error.code === "INVALID_TRANSITION" ? "Bu status ke\u00e7idi m\u00fcmk\u00fcn deyil" : error.code === "NO_STORE_ORDERS" ? "Sifari\u015f ma\u011faza s\u0259trl\u0259rini ehtiva etmir" : error.code === "NOT_FOUND" ? "Sifari\u015f tap\u0131lmad\u0131" : "Sifari\u015f paralel olaraq yenil\u0259ndi";
      return NextResponse.json({ error: message }, { status });
    }
    if (error instanceof Error && "code" in error && error.code === "P2025") return NextResponse.json({ error: "Qeyd tapılmadı" }, { status: 404 });
    if (error instanceof Error && "code" in error && error.code === "P2002") return NextResponse.json({ error: "Bu məlumat artıq istifadə olunur" }, { status: 409 });
    logSecurityOperationFailure("admin_resource_update", error);
    return NextResponse.json({ error: "Əməliyyat tamamlana bilmədi" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ resource: string[] }> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const { resource } = await params; const section = resource.join("/");
  let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400 }); }
  const parsed = z.object({ id: z.string().min(1) }).safeParse(body); if (!parsed.success) return NextResponse.json({ error: "Rəy identifikatoru yanlışdır" }, { status: 422 });
  if (section === "categories") {
    try {
      const deleted = await db.$transaction(async (tx: any) => {
        const category = await tx.category.findUnique({ where: { id: parsed.data.id }, select: { id: true, _count: { select: { products: true, children: true } } } });
        if (!category) return "NOT_FOUND";
        if (category._count.products || category._count.children) return "IN_USE";
        await tx.category.delete({ where: { id: category.id } });
        await tx.auditLog.create({ data: { actorId: admin.id, action: "CATEGORY_DELETE", entityType: "Category", entityId: category.id } });
        return "DELETED";
      });
      if (deleted === "NOT_FOUND") return NextResponse.json({ error: "Kateqoriya tapılmadı" }, { status: 404 });
      if (deleted === "IN_USE") return NextResponse.json({ error: "Məhsulu və ya alt kateqoriyası olan kateqoriya silinmir; onu deaktiv edin." }, { status: 409 });
      return NextResponse.json({ deleted: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "P2003") return NextResponse.json({ error: "Kateqoriya əlaqəli qeydlər səbəbindən silinmədi; onu deaktiv edin." }, { status: 409 });
      logSecurityOperationFailure("admin_category_delete", error);
      return NextResponse.json({ error: "Kateqoriyanı silmək mümkün olmadı" }, { status: 500 });
    }
  }
  if (section !== "reviews") return NextResponse.json({ error: "Tarixçə və əlaqəli qeydlər qorunur; silmə dəstəklənmir" }, { status: 405 });
  try {
    const deleted = await db.$transaction(async (tx: any) => {
      const result = await tx.review.deleteMany({ where: { id: parsed.data.id } });
      if (!result.count) return false;
      await tx.auditLog.create({ data: { actorId: admin.id, action: "REVIEW_REMOVE", entityType: "Review", entityId: parsed.data.id } });
      return true;
    });
    if (!deleted) return NextResponse.json({ error: "Rəy tapılmadı" }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    logSecurityOperationFailure("admin_review_delete", error);
    return NextResponse.json({ error: "Rəyi silmək mümkün olmadı" }, { status: 503 });
  }
}
