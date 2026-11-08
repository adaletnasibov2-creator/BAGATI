import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isStoreAlreadyDeactivated, STORE_ARCHIVE_UPDATE } from "@/lib/admin-store-archive";

export async function POST(_request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });

  const { storeId } = await params;
  const parsedId = z.string().trim().min(1).max(64).safeParse(storeId);
  if (!parsedId.success) return NextResponse.json({ error: "Mağaza identifikatoru yanlışdır" }, { status: 422 });

  try {
    const existing = await prisma.store.findUnique({
      where: { id: parsedId.data },
      select: { id: true, status: true, isActive: true },
    });
    if (!existing) return NextResponse.json({ error: "Mağaza tapılmadı" }, { status: 404 });
    if (isStoreAlreadyDeactivated(existing.status, existing.isActive)) {
      return NextResponse.json({ archived: true, message: "Mağaza artıq satışdan deaktiv edilib. Tarixi qeydlər saxlanılır." });
    }

    const item = await prisma.$transaction(async (tx) => {
      const changed = await tx.store.updateMany({
        where: { id: existing.id, status: existing.status, isActive: existing.isActive },
        data: STORE_ARCHIVE_UPDATE,
      });
      if (!changed.count) throw new Error("STORE_CHANGED_CONCURRENTLY");
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "STORE_DEACTIVATE_ARCHIVE",
          entityType: "Store",
          entityId: existing.id,
          metadata: { permanentDeletion: false, historyPreserved: true },
        },
      });
      return tx.store.findUnique({ where: { id: existing.id }, select: { id: true, status: true, isActive: true } });
    });

    return NextResponse.json({
      item,
      archived: true,
      message: "Mağaza daimi silinmədi; satışdan deaktiv edildi və tarixi qeydlər saxlanıldı.",
    });
  } catch (error) {
    if (error instanceof Error && error.message === "STORE_CHANGED_CONCURRENTLY") {
      return NextResponse.json({ error: "Mağazanın statusu paralel dəyişdirildi. Səhifəni yeniləyib təkrar yoxlayın." }, { status: 409 });
    }
    return NextResponse.json({ error: "Mağazanı deaktiv etmək mümkün olmadı. Məlumatlar dəyişdirilməyib." }, { status: 500 });
  }
}
