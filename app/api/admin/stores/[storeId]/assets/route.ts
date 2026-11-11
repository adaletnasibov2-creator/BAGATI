import { NextRequest, NextResponse } from "next/server";
import { csrfRejection } from "@/lib/csrf";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readBoundedRequestBytes } from "@/lib/request-body";
import {
  activeStoreAssetDriver,
  getOwnedStoreAssetKey,
  getStoreAssetDriverForUrl,
  getStoreAssetStorage,
  validateAndNormalizeStoreImage,
  withStorageSlot,
} from "@/lib/storage/store-assets";
import { isStorefrontAssetReferenced } from "@/lib/storefront-branding-compat";

export const runtime = "nodejs";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FORM_BYTES = MAX_IMAGE_BYTES + 128 * 1024;
const STORE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export async function POST(request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const { storeId } = await params;
  if (!STORE_ID_PATTERN.test(storeId)) return NextResponse.json({ error: "Mağaza identifikatoru yanlışdır" }, { status: 422 });
  if (!await prisma.store.findUnique({ where: { id: storeId }, select: { id: true } })) {
    return NextResponse.json({ error: "Mağaza tapılmadı" }, { status: 404 });
  }
  return withStorageSlot(() => storeAdminAsset(request, storeId));
}

async function storeAdminAsset(request: NextRequest, storeId: string) {
  let body: Uint8Array;
  try { body = await readBoundedRequestBytes(request, MAX_FORM_BYTES); }
  catch (error) {
    if (error instanceof Error && error.message === "BODY_TOO_LARGE") return NextResponse.json({ error: "Şəkil 5 MB-dan böyük ola bilməz" }, { status: 413 });
    return NextResponse.json({ error: "Şəkil faylı oxunmadı" }, { status: 400 });
  }
  const formBody = new ArrayBuffer(body.byteLength);
  new Uint8Array(formBody).set(body);
  let form: FormData;
  try { form = await new Request(request.url, { method: "POST", headers: request.headers, body: formBody }).formData(); }
  catch { return NextResponse.json({ error: "Şəkil faylı oxunmadı" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Yükləmək üçün şəkil seçin" }, { status: 400 });
  if (file.size < 1 || file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Şəkil 5 MB-dan böyük ola bilməz" }, { status: 413 });
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return NextResponse.json({ error: "Yalnız JPEG, PNG və WebP şəkilləri qəbul edilir" }, { status: 415 });
  const validated = await validateAndNormalizeStoreImage(new Uint8Array(await file.arrayBuffer()), file.type, MAX_IMAGE_BYTES);
  if (!validated) return NextResponse.json({ error: "Fayl etibarlı JPEG, PNG və ya WebP şəkli deyil" }, { status: 415 });
  try {
    const asset = await getStoreAssetStorage().save(storeId, validated.bytes, validated.contentType);
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error && (error.message.includes("STORAGE") || error.message.includes("PRODUCTION_STORAGE"))
      ? "Davamlı şəkil yaddaşı sazlanmayıb."
      : "Şəkil yadda saxlanıla bilmədi.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const { storeId } = await params;
  if (!STORE_ID_PATTERN.test(storeId)) return NextResponse.json({ error: "Mağaza identifikatoru yanlışdır" }, { status: 422 });
  if (!await prisma.store.findUnique({ where: { id: storeId }, select: { id: true } })) return NextResponse.json({ error: "Mağaza tapılmadı" }, { status: 404 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Şəkil məlumatı yanlışdır" }, { status: 400 }); }
  const url = body && typeof body === "object" && "url" in body && typeof body.url === "string" ? body.url : "";
  const key = getOwnedStoreAssetKey(storeId, url);
  const urlDriver = getStoreAssetDriverForUrl(storeId, url);
  if (!key || !urlDriver) return NextResponse.json({ error: "Bu mağazaya aid şəkil tapılmadı" }, { status: 404 });
  if (activeStoreAssetDriver() !== urlDriver) return NextResponse.json({ error: "Şəkil cari yaddaş provayderində deyil" }, { status: 409 });

  const [storeReference, productReference, variantReference] = await Promise.all([
    isStorefrontAssetReferenced(storeId, url),
    prisma.product.findFirst({ where: { storeId, images: { has: url } }, select: { id: true } }),
    prisma.productVariant.findFirst({ where: { product: { storeId }, images: { has: url } }, select: { id: true } }),
  ]);
  if (storeReference || productReference || variantReference) return NextResponse.json({ error: "İstifadə olunan şəkli əvvəlcə mağaza və məhsul məlumatlarından çıxarın" }, { status: 409 });
  try {
    await getStoreAssetStorage().delete(storeId, key);
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ error: "Şəkil silinə bilmədi" }, { status: 503 });
  }
}
