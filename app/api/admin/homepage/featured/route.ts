import { NextRequest, NextResponse } from "next/server";
import { csrfRejection } from "@/lib/csrf";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { homepageFeaturedSchema } from "@/lib/site-content";
import {
  filterEligiblePublicProducts,
  filterEligiblePublicStores,
  resolvePublicStoreEligibility,
  publicStoreWhere,
} from "@/lib/store-eligibility";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const [productCandidates, storeCandidates, selectedProducts, selectedStores] = await Promise.all([
    prisma.product.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, storeId: true, store: { select: { name: true } } }, take: 500 }),
    prisma.store.findMany({ where: publicStoreWhere(), orderBy: { name: "asc" }, select: { id: true, name: true, city: { select: { name: true } } }, take: 500 }),
    prisma.homepageFeaturedProduct.findMany({ orderBy: { position: "asc" }, select: { productId: true } }),
    prisma.homepageFeaturedStore.findMany({ orderBy: { position: "asc" }, select: { storeId: true } }),
  ]);
  const [products, stores] = await Promise.all([
    filterEligiblePublicProducts(productCandidates),
    filterEligiblePublicStores(storeCandidates),
  ]);
  return NextResponse.json({
    products: products.map((item) => ({ id: item.id, name: `${item.name} · ${item.store.name}` })),
    stores: stores.map((item) => ({ id: item.id, name: `${item.name} · ${item.city.name}` })),
    productIds: selectedProducts.map((item) => item.productId),
    storeIds: selectedStores.map((item) => item.storeId),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const raw: unknown = await request.json().catch(() => null);
  const parsed = homepageFeaturedSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Ana səhifə seçimlərini yoxlayın" }, { status: 422 });

  const [products, stores] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: parsed.data.productIds } }, select: { id: true, status: true, storeId: true } }),
    prisma.store.findMany({ where: { id: { in: parsed.data.storeIds } }, select: { id: true } }),
  ]);
  if (products.length !== parsed.data.productIds.length || stores.length !== parsed.data.storeIds.length) {
    return NextResponse.json({ error: "Seçilmiş məhsul və ya mağaza tapılmadı" }, { status: 422 });
  }
  const [eligibleProductIds, eligibleStoreIds] = await Promise.all([
    resolvePublicStoreEligibility(products.map((product) => product.storeId)),
    resolvePublicStoreEligibility(parsed.data.storeIds),
  ]);
  if (
    products.some((product) => product.status !== "ACTIVE" || !eligibleProductIds.has(product.storeId))
    || eligibleStoreIds.size !== parsed.data.storeIds.length
  ) {
    return NextResponse.json({ error: "Seçilmiş məhsul və ya mağaza satış üçün uyğun deyil" }, { status: 422 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.homepageFeaturedProduct.deleteMany();
    await tx.homepageFeaturedStore.deleteMany();
    if (parsed.data.productIds.length) {
      await tx.homepageFeaturedProduct.createMany({ data: parsed.data.productIds.map((productId, position) => ({ productId, position })) });
    }
    if (parsed.data.storeIds.length) {
      await tx.homepageFeaturedStore.createMany({ data: parsed.data.storeIds.map((storeId, position) => ({ storeId, position })) });
    }
    await tx.auditLog.create({
      data: {
        actorId: admin.id,
        action: "HOMEPAGE_FEATURED_UPDATE",
        entityType: "Homepage",
        metadata: { productIds: parsed.data.productIds, storeIds: parsed.data.storeIds },
      },
    });
  });
  return NextResponse.json({ message: "Ana səhifə seçimləri yadda saxlanıldı." });
}
