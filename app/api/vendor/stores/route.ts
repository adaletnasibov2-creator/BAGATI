import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const db: any = prisma;

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().max(120).optional().or(z.literal("")),
  description: z.string().trim().max(3000).optional().nullable(),
  cityId: z.string().min(1),
  planId: z.string().min(1).optional().or(z.literal("")),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  latitude: z.number().finite().min(-90).max(90).optional().nullable(),
  longitude: z.number().finite().min(-180).max(180).optional().nullable(),
  mapUrl: z.string().url().max(1000).optional().nullable(),
  contactPhone: z.string().trim().min(5).max(40).optional().or(z.literal("")),
  contactEmail: z.string().trim().email().max(254).optional().or(z.literal("")),
});

function slugify(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "magaza";
}

export async function GET() {
  const user = await currentUser();
  if (!user || user.role !== "VENDOR") return NextResponse.json({ error: "Satıcı hesabına giriş tələb olunur" }, { status: 403 });
  const [cities, plans] = await Promise.all([
    prisma.city.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.subscriptionPlan.findMany({ where: { isActive: true }, select: { id: true, name: true, description: true, monthlyPrice: true }, orderBy: { monthlyPrice: "asc" } }),
  ]);
  return NextResponse.json({ cities, plans });
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user || user.role !== "VENDOR") return NextResponse.json({ error: "Satıcı hesabına giriş tələb olunur" }, { status: 403 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Mağaza məlumatlarını yoxlayın", details: parsed.error.flatten() }, { status: 422 });
  const data = parsed.data;
  if ((data.latitude == null) !== (data.longitude == null)) return NextResponse.json({ error: "Xəritə üçün enlik və uzunluq birlikdə daxil edilməlidir" }, { status: 422 });
  if (data.mapUrl && !/^https:\/\//i.test(data.mapUrl)) return NextResponse.json({ error: "Xəritə linki HTTPS olmalıdır" }, { status: 422 });

  const [profile, city, plan] = await Promise.all([
    prisma.vendorProfile.findUnique({ where: { userId: user.id }, select: { id: true } }),
    prisma.city.findFirst({ where: { id: data.cityId, isActive: true }, select: { id: true } }),
    data.planId ? db.subscriptionPlan.findFirst({ where: { id: data.planId, isActive: true }, select: { id: true } }) : Promise.resolve(null),
  ]);
  if (!profile) return NextResponse.json({ error: "Satıcı profili tapılmadı" }, { status: 403 });
  if (!city || (data.planId && !plan)) return NextResponse.json({ error: "Seçilmiş şəhər və ya tarif artıq aktiv deyil" }, { status: 422 });

  const baseSlug = slugify(data.slug || data.name).slice(0, 60);
  try {
    const store = await db.$transaction(async (tx: any) => {
      let slug = baseSlug;
      for (let attempt = 0; attempt < 5; attempt++) {
        const existing = await tx.store.findUnique({ where: { slug }, select: { id: true } });
        if (!existing) break;
        slug = `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;
      }
      return tx.store.create({
        data: {
          vendorId: profile.id,
          cityId: city.id,
          name: data.name,
          slug,
          description: data.description || null,
          address: data.address || null,
          latitude: data.latitude ?? null,
          longitude: data.longitude ?? null,
          mapUrl: data.mapUrl || null,
          contactPhone: data.contactPhone || null,
          contactEmail: data.contactEmail ? data.contactEmail.toLowerCase() : null,
          status: "DRAFT",
          isActive: false,
          ...(plan ? { subscription: { create: { planId: plan.id, status: "PENDING" } } } : {}),
        },
        select: { id: true, name: true, slug: true, status: true, isActive: true },
      });
    });
    return NextResponse.json({ store, message: plan ? "Mağaza qaralama kimi yaradıldı. Seçilmiş abunəlik ödəniş olmadığı üçün gözləyir." : "Mağaza qaralama kimi yaradıldı. Əlaqə və plan məlumatlarını qurulumda sonra əlavə edə bilərsiniz." }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P2002") return NextResponse.json({ error: "Bu mağaza adı üçün unikal ünvan yaradıla bilmədi. Başqa ad sınayın." }, { status: 409 });
    return NextResponse.json({ error: "Mağaza yaradıla bilmədi" }, { status: 500 });
  }
}
