import { NextRequest, NextResponse } from "next/server";
import { csrfRejection } from "@/lib/csrf";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { adminPromotionSchema, hasAdminPromotionConflict } from "@/lib/admin-product-management";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const [items, stores, products] = await Promise.all([
    prisma.promotion.findMany({
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
      include: { products: { select: { productId: true, product: { select: { name: true } } } }, store: { select: { id: true, name: true } } },
    }),
    prisma.store.findMany({ where: { status: "ACTIVE", isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true }, take: 500 }),
    prisma.product.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, price: true, storeId: true, store: { select: { name: true } } }, take: 1000 }),
  ]);
  return NextResponse.json({
    items,
    stores,
    products: products.map((item) => ({ id: item.id, storeId: item.storeId, name: `${item.name} · ${item.store.name}`, price: item.price.toString() })),
  }, { headers: { "Cache-Control": "no-store" } });
}

type PromotionValidationClient = Pick<typeof prisma, "store" | "product" | "promotionProduct">;

async function validatePromotionInput(raw: unknown, id?: string, client: PromotionValidationClient = prisma) {
  const parsed = adminPromotionSchema.safeParse(raw);
  if (!parsed.success) return { response: NextResponse.json({ error: "Kampaniya məlumatlarını yoxlayın", details: parsed.error.flatten() }, { status: 422 }) } as const;
  const values = parsed.data;
  if (id && values.id !== id) return { response: NextResponse.json({ error: "Kampaniya identifikatoru uyğun gəlmir" }, { status: 422 }) } as const;
  const productIds = [...values.productIds];
  const store = await client.store.findFirst({
    where: { id: values.storeId, status: "ACTIVE", isActive: true },
    select: { id: true },
  });
  if (!store) return { response: NextResponse.json({ error: "Aktiv mağaza tapılmadı" }, { status: 422 }) } as const;
  const products = await client.product.findMany({
    where: { id: { in: productIds }, storeId: values.storeId, status: "ACTIVE" },
    select: { id: true, price: true },
  });
  if (products.length !== productIds.length) return { response: NextResponse.json({ error: "Yalnız seçilmiş mağazanın aktiv məhsulları istifadə edilə bilər" }, { status: 422 }) } as const;
  if (values.discountType === "FIXED" && products.some((product) => values.discountValue >= Number(product.price))) {
    return { response: NextResponse.json({ error: "Sabit endirim hər seçilmiş məhsulun qiymətindən aşağı olmalıdır" }, { status: 422 }) } as const;
  }
  if (values.isActive) {
    const overlaps = await client.promotionProduct.findMany({
      where: {
        productId: { in: productIds },
        ...(id ? { promotionId: { not: id } } : {}),
        promotion: {
          storeId: values.storeId,
          isActive: true,
          startsAt: { lt: values.endsAt },
          endsAt: { gt: values.startsAt },
        },
      },
      select: { productId: true, promotion: { select: { startsAt: true, endsAt: true, isActive: true } } },
    });
    const conflict = productIds.some((productId) =>
      hasAdminPromotionConflict(
        values,
        overlaps.filter((row) => row.productId === productId).map((row) => row.promotion),
      ),
    );
    if (conflict) return { response: NextResponse.json({ error: "Eyni məhsula eyni dövrdə başqa aktiv kampaniya var" }, { status: 409 }) } as const;
  }
  return { values, productIds } as const;
}

export async function POST(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Kampaniya məlumatı yanlışdır" }, { status: 400 }); }
  if (!adminPromotionSchema.safeParse(raw).success) return NextResponse.json({ error: "Kampaniya məlumatlarını yoxlayın" }, { status: 422 });
  try {
    const item = await prisma.$transaction(async (tx) => {
      const inTransaction = await validatePromotionInput(raw, undefined, tx);
      if ("response" in inTransaction) return { response: inTransaction.response } as const;
      const promotion = await tx.promotion.create({
        data: {
          storeId: inTransaction.values.storeId,
          name: inTransaction.values.name,
          description: inTransaction.values.description,
          startsAt: inTransaction.values.startsAt,
          endsAt: inTransaction.values.endsAt,
          isActive: inTransaction.values.isActive,
          discountType: inTransaction.values.discountType,
          discountValue: new Prisma.Decimal(inTransaction.values.discountValue),
          products: { create: inTransaction.productIds.map((productId) => ({ productId })) },
        },
      });
      await tx.auditLog.create({ data: { actorId: admin.id, action: "ADMIN_PROMOTION_CREATE", entityType: "Promotion", entityId: promotion.id, metadata: { storeId: inTransaction.values.storeId, productCount: inTransaction.productIds.length } } });
      return { item: promotion } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if ("response" in item) return item.response;
    return NextResponse.json({ item: item.item, message: "Kampaniya yaradıldı." }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return NextResponse.json({ error: "Kampaniyalar eyni vaxtda dəyişib; yenidən yoxlayın." }, { status: 409 });
    throw error;
  }
}

export async function PATCH(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Kampaniya məlumatı yanlışdır" }, { status: 400 }); }
  const idResult = z.object({ id: z.string().min(1) }).safeParse(raw);
  if (!idResult.success) return NextResponse.json({ error: "Kampaniya identifikatoru yanlışdır" }, { status: 422 });
  if (!adminPromotionSchema.safeParse(raw).success) return NextResponse.json({ error: "Kampaniya məlumatlarını yoxlayın" }, { status: 422 });
  try {
    const item = await prisma.$transaction(async (tx) => {
      const inTransaction = await validatePromotionInput(raw, idResult.data.id, tx);
      if ("response" in inTransaction) return { response: inTransaction.response } as const;
      const updated = await tx.promotion.update({
        where: { id: idResult.data.id },
        data: {
          storeId: inTransaction.values.storeId,
          name: inTransaction.values.name,
          description: inTransaction.values.description,
          startsAt: inTransaction.values.startsAt,
          endsAt: inTransaction.values.endsAt,
          isActive: inTransaction.values.isActive,
          discountType: inTransaction.values.discountType,
          discountValue: new Prisma.Decimal(inTransaction.values.discountValue),
        },
      });
      await tx.promotionProduct.deleteMany({ where: { promotionId: updated.id } });
      await tx.promotionProduct.createMany({ data: inTransaction.productIds.map((productId) => ({ promotionId: updated.id, productId })) });
      await tx.auditLog.create({ data: { actorId: admin.id, action: "ADMIN_PROMOTION_UPDATE", entityType: "Promotion", entityId: updated.id, metadata: { storeId: inTransaction.values.storeId, productCount: inTransaction.productIds.length } } });
      return { item: updated } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if ("response" in item) return item.response;
    return NextResponse.json({ item: item.item, message: "Kampaniya yeniləndi." });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return NextResponse.json({ error: "Kampaniyalar eyni vaxtda dəyişib; yenidən yoxlayın." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return NextResponse.json({ error: "Kampaniya tapılmadı" }, { status: 404 });
    throw error;
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Kampaniya identifikatoru tələb olunur" }, { status: 422 });
  const changed = await prisma.$transaction(async (tx) => {
    const result = await tx.promotion.updateMany({ where: { id, isActive: true }, data: { isActive: false } });
    if (result.count) await tx.auditLog.create({ data: { actorId: admin.id, action: "ADMIN_PROMOTION_DEACTIVATE", entityType: "Promotion", entityId: id } });
    return result.count;
  });
  if (!changed) return NextResponse.json({ error: "Aktiv kampaniya tapılmadı" }, { status: 404 });
  return NextResponse.json({ deactivated: true, message: "Kampaniya deaktiv edildi." });
}
