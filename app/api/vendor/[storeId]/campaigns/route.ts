import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireStoreAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolvePublicStoreEligibility } from "@/lib/store-eligibility";
import { calculateCampaignPrice, hasOverlappingEnabledPromotion, promotionStatus } from "@/lib/promotion-pricing";

const db: any = prisma;
const campaignSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(3000).nullable().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  discountType: z.enum(["PERCENT", "FIXED"]),
  discountValue: z.coerce.number().positive().refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7, "Endirim dəyəri maksimum iki onluq mərtəbə ola bilər"),
  isActive: z.boolean(),
  productIds: z.array(z.string().min(1)).min(1).max(100),
});
const includes = { products: { include: { product: { select: { id: true, name: true, sku: true, status: true, price: true } } } } };

async function accessFor(storeId: string) {
  const access = await requireStoreAccess(storeId);
  return access?.user.role === "VENDOR" ? access : null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await accessFor(storeId);
  if (!access) return NextResponse.json({ error: "Mağazaya giriş icazəsi yoxdur" }, { status: 403 });
  const q = request.nextUrl.searchParams.get("q")?.trim() || "";
  const [items, products] = await Promise.all([
    db.promotion.findMany({ where: { storeId: access.storeId }, include: includes, orderBy: { startsAt: "desc" } }),
    db.product.findMany({ where: { storeId: access.storeId, status: "ACTIVE", ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] } : {}) }, select: { id: true, name: true, sku: true, price: true }, orderBy: { name: "asc" }, take: 30 }),
  ]);
  const now = new Date();
  return NextResponse.json({ items: items.map((item: any) => ({ ...item, effectiveStatus: promotionStatus(item, now) })), products });
}

async function validateProducts(tx: any, storeId: string, productIds: string[], discountType: string, discountValue: number) {
  const ids = [...new Set(productIds)];
  if (ids.length !== productIds.length) throw new Error("DUPLICATE_PRODUCT");
  const products = await tx.product.findMany({ where: { id: { in: ids }, storeId, status: "ACTIVE" }, select: { id: true, price: true } });
  if (products.length !== ids.length) throw new Error("PRODUCT_NOT_OWNED_OR_ACTIVE");
  if (products.some((product: any) => calculateCampaignPrice(product.price, discountType, discountValue) === null)) throw new Error("DISCOUNT_TOO_LARGE");
  return ids;
}

async function ensureNoConflict(tx: any, storeId: string, startsAt: Date, endsAt: Date, productIds: string[], excludingId?: string) {
  const existing = await tx.promotion.findMany({
    where: { storeId, isActive: true, startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, ...(excludingId ? { id: { not: excludingId } } : {}), products: { some: { productId: { in: productIds } } } },
    include: { products: { where: { productId: { in: productIds } }, select: { productId: true } } },
  });
  const relevant = existing.filter((campaign: any) => campaign.products.some((link: any) => productIds.includes(link.productId)));
  if (hasOverlappingEnabledPromotion(startsAt, endsAt, relevant)) throw new Error("PROMOTION_CONFLICT");
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "ERROR";
  const messages: Record<string, string> = {
    PROMOTION_CONFLICT: "Seçilmiş məhsul bu tarixlərdə başqa aktiv kampaniyadadır.",
    PRODUCT_NOT_OWNED_OR_ACTIVE: "Seçilmiş aktiv məhsullardan biri bu mağazaya aid deyil.",
    DISCOUNT_TOO_LARGE: "Sabit endirim hər seçilmiş məhsulun qiymətindən aşağı olmalıdır.",
    DUPLICATE_PRODUCT: "Məhsul kampaniyada təkrar seçilib.",
    STORE_NOT_ELIGIBLE: "Mağaza aktiv deyil və ya abunəliyi uyğun deyil.",
  };
  return NextResponse.json({ error: messages[code] || "Kampaniya saxlanılmadı." }, { status: code === "PROMOTION_CONFLICT" ? 409 : code in messages ? 422 : 500 });
}

async function assertStoreEligible(tx: any, storeId: string) {
  const eligibleStoreIds = await resolvePublicStoreEligibility([storeId], tx);
  if (!eligibleStoreIds.has(storeId)) throw new Error("STORE_NOT_ELIGIBLE");
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await accessFor(storeId);
  if (!access) return NextResponse.json({ error: "Mağazaya giriş icazəsi yoxdur" }, { status: 403 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400 }); }
  const parsed = campaignSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Kampaniya məlumatlarını yoxlayın", details: parsed.error.flatten() }, { status: 422 });
  const value = parsed.data, startsAt = new Date(value.startsAt), endsAt = new Date(value.endsAt);
  if (endsAt <= startsAt) return NextResponse.json({ error: "Bitmə tarixi başlanğıcdan sonra olmalıdır" }, { status: 422 });
  if (value.discountType === "PERCENT" && value.discountValue >= 100) return NextResponse.json({ error: "Faiz endirimi 100%-dən az olmalıdır" }, { status: 422 });
  try {
    const item = await db.$transaction(async (tx: any) => {
      const productIds = await validateProducts(tx, access.storeId, value.productIds, value.discountType, value.discountValue);
      if (value.isActive) {
        await assertStoreEligible(tx, access.storeId);
        await ensureNoConflict(tx, access.storeId, startsAt, endsAt, productIds);
      }
      return tx.promotion.create({ data: { storeId: access.storeId, name: value.name, description: value.description || null, startsAt, endsAt, isActive: value.isActive, discountType: value.discountType, discountValue: new Prisma.Decimal(value.discountValue), products: { create: productIds.map(productId => ({ productId })) } }, include: includes });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await accessFor(storeId);
  if (!access) return NextResponse.json({ error: "Mağazaya giriş icazəsi yoxdur" }, { status: 403 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400 }); }
  const input = z.object({ id: z.string().min(1), ...campaignSchema.shape }).safeParse(raw);
  if (!input.success) return NextResponse.json({ error: "Kampaniya məlumatlarını yoxlayın", details: input.error.flatten() }, { status: 422 });
  const value = input.data, startsAt = new Date(value.startsAt), endsAt = new Date(value.endsAt);
  if (endsAt <= startsAt) return NextResponse.json({ error: "Bitmə tarixi başlanğıcdan sonra olmalıdır" }, { status: 422 });
  if (value.discountType === "PERCENT" && value.discountValue >= 100) return NextResponse.json({ error: "Faiz endirimi 100%-dən az olmalıdır" }, { status: 422 });
  try {
    const item = await db.$transaction(async (tx: any) => {
      const existing = await tx.promotion.findFirst({ where: { id: value.id, storeId: access.storeId } });
      if (!existing) throw new Error("NOT_FOUND");
      const productIds = await validateProducts(tx, access.storeId, value.productIds, value.discountType, value.discountValue);
      if (value.isActive) {
        await assertStoreEligible(tx, access.storeId);
        await ensureNoConflict(tx, access.storeId, startsAt, endsAt, productIds, existing.id);
      }
      await tx.promotionProduct.deleteMany({ where: { promotionId: existing.id } });
      return tx.promotion.update({ where: { id: existing.id }, data: { name: value.name, description: value.description || null, startsAt, endsAt, isActive: value.isActive, discountType: value.discountType, discountValue: new Prisma.Decimal(value.discountValue), products: { create: productIds.map(productId => ({ productId })) } }, include: includes });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ item });
  } catch (error) { if (error instanceof Error && error.message === "NOT_FOUND") return NextResponse.json({ error: "Kampaniya tapılmadı" }, { status: 404 }); return errorResponse(error); }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await accessFor(storeId);
  if (!access) return NextResponse.json({ error: "Mağazaya giriş icazəsi yoxdur" }, { status: 403 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Kampaniya ID-si tələb olunur" }, { status: 400 });
  const result = await db.promotion.updateMany({ where: { id, storeId: access.storeId }, data: { isActive: false } });
  if (!result.count) return NextResponse.json({ error: "Kampaniya tapılmadı" }, { status: 404 });
  return NextResponse.json({ archived: true });
}
