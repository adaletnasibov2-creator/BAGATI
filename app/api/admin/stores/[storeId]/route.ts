import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStoreDeletionBlockers } from "@/lib/admin-store-deletion";

export async function DELETE(_request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });

  const { storeId } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(storeId)) {
    return NextResponse.json({ error: "Mağaza identifikatoru yanlışdır" }, { status: 422 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Store" WHERE "id" = ${storeId} FOR UPDATE`;
      const store = await tx.store.findUnique({
        where: { id: storeId },
        select: {
          id: true,
          name: true,
          status: true,
          isActive: true,
          _count: { select: { products: true, storeOrders: true, promotions: true, commissions: true, notifications: true, returnRequests: true } },
          subscription: { select: { id: true } },
        },
      });
      if (!store) return { kind: "NOT_FOUND" as const };

      const productImports = await tx.productImport.count({ where: { storeId } });
      const blockers = getStoreDeletionBlockers({
        ...store._count,
        productImports,
        hasSubscription: Boolean(store.subscription),
      });
      if (blockers.length) {
        const changed = await tx.store.updateMany({
          where: { id: store.id, status: store.status },
          data: { status: "SUSPENDED", isActive: false },
        });
        if (!changed.count) return { kind: "CONCURRENT_CHANGE" as const };
        await tx.auditLog.create({
          data: {
            actorId: admin.id,
            action: "STORE_DELETE_ARCHIVE",
            entityType: "Store",
            entityId: store.id,
            metadata: {
              name: store.name,
              previousStatus: store.status,
              previousIsActive: store.isActive,
              nextStatus: "SUSPENDED",
              nextIsActive: false,
              historyPreserved: true,
              blockers,
            },
          },
        });
        return { kind: "ARCHIVED" as const };
      }

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "STORE_PERMANENT_DELETE",
          entityType: "Store",
          entityId: store.id,
          metadata: { name: store.name, previousStatus: store.status, permanentDeletion: true, historyPreserved: true },
        },
      });
      await tx.store.delete({ where: { id: store.id }, select: { id: true } });
      return { kind: "DELETED" as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (result.kind === "NOT_FOUND") return NextResponse.json({ error: "Mağaza tapılmadı" }, { status: 404 });
    if (result.kind === "CONCURRENT_CHANGE") return NextResponse.json({ error: "Mağaza paralel dəyişdirildi. Səhifəni yeniləyib təkrar yoxlayın." }, { status: 409 });
    if (result.kind === "ARCHIVED") return NextResponse.json({ archived: true, message: "Mağaza aktiv sistemdən çıxarıldı; sifariş, maliyyə və digər tarixçə qorunub." });
    return NextResponse.json({ deleted: true, message: "Əlaqəli iş tarixçəsi olmayan mağaza silindi; audit qeydi saxlanıldı." });
  } catch {
    return NextResponse.json({ error: "Mağazanı sistemdən çıxarmaq mümkün olmadı. Məlumatlar dəyişdirilməyib." }, { status: 500 });
  }
}
