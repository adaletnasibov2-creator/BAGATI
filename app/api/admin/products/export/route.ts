import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { escapeAdminReportCsvCell } from "@/lib/admin-report-csv";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const exportQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  storeId: z.string().max(80).optional(),
  categoryId: z.string().max(80).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
}).strict();

function findExportPage(where: Prisma.ProductWhereInput, cursor?: string) {
  return prisma.product.findMany({
    where,
    orderBy: { id: "asc" },
    take: 250,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      name: true,
      sku: true,
      description: true,
      price: true,
      discountPrice: true,
      status: true,
      images: true,
      category: { select: { name: true } },
      store: { select: { name: true } },
      inventory: { select: { quantity: true } },
      variants: {
        select: {
          name: true,
          sku: true,
          options: true,
          price: true,
          discountPrice: true,
          inventory: { select: { quantity: true } },
        },
      },
    },
  });
}

export async function GET(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });

  const parsed = exportQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "İxrac filtrlərini yoxlayın" }, { status: 422 });
  const { q, storeId, categoryId, status } = parsed.data;
  const where: Prisma.ProductWhereInput = {
    ...(status ? { status } : {}),
    ...(storeId ? { storeId } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(q ? { OR: [
      { name: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
      { store: { name: { contains: q, mode: "insensitive" } } },
    ] } : {}),
  };

  const encoder = new TextEncoder();
  let page: Awaited<ReturnType<typeof findExportPage>> = [];
  let pageOffset = 0;
  let cursor: string | undefined;
  let finished = false;
  const header = ["id", "name", "sku", "description", "category", "store", "price", "discountPrice", "status", "stock", "images", "variants"].map(escapeAdminReportCsvCell).join(",");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`\uFEFF${header}\r\n`));
    },
    async pull(controller) {
      try {
        if (pageOffset >= page.length && !finished) {
          page = await findExportPage(where, cursor);
          pageOffset = 0;
          if (page.length === 0) {
            finished = true;
            controller.close();
            return;
          }
          cursor = page[page.length - 1].id;
          if (page.length < 250) finished = true;
        }
        if (pageOffset < page.length) {
          const chunk = page.slice(pageOffset, pageOffset + 50).map((product) => {
            const variants = product.variants.map((variant) => ({
              name: variant.name,
              sku: variant.sku,
              options: variant.options,
              price: variant.price?.toString() ?? null,
              discountPrice: variant.discountPrice?.toString() ?? null,
              stock: variant.inventory.reduce((sum, item) => sum + item.quantity, 0),
            }));
            return [
              product.id,
              product.name,
              product.sku ?? "",
              product.description ?? "",
              product.category?.name ?? "",
              product.store.name,
              product.price.toString(),
              product.discountPrice?.toString() ?? "",
              product.status,
              String(product.inventory.reduce((sum, item) => sum + item.quantity, 0)),
              JSON.stringify(product.images),
              JSON.stringify(variants),
            ].map(escapeAdminReportCsvCell).join(",");
          }).join("\r\n");
          pageOffset += Math.min(50, page.length - pageOffset);
          controller.enqueue(encoder.encode(`${chunk}\r\n`));
          return;
        }
        if (finished) controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="bagati-products.csv"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
