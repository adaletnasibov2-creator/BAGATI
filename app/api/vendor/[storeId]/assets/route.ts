import { NextRequest, NextResponse } from "next/server";
import { requireStoreAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readBoundedRequestBytes } from "@/lib/request-body";
import { activeStoreAssetDriver, getOwnedStoreAssetKey, getStoreAssetDriverForUrl, getStoreAssetStorage, validateAndNormalizeStoreImage, withStorageSlot } from "@/lib/storage/store-assets";
import { isStorefrontAssetReferenced } from "@/lib/storefront-branding-compat";

export const runtime = "nodejs";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FORM_BYTES = MAX_IMAGE_BYTES + 128 * 1024;

export async function POST(request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await requireStoreAccess(storeId);
  if (!access || access.user.role !== "VENDOR") return NextResponse.json({ error: "Mağazaya giriş icazəsi yoxdur" }, { status: 403 });
  return withStorageSlot(() => storeVendorAsset(request, access.storeId));
}

async function storeVendorAsset(request: NextRequest, storeId: string) {
  let body: Uint8Array;
  try {
    body = await readBoundedRequestBytes(request, MAX_FORM_BYTES);
  } catch (error) {
    if (error instanceof Error && error.message === "BODY_TOO_LARGE") return NextResponse.json({ error: "Şəkil 5 MB-dan kiçik olmalıdır" }, { status: 413 });
    return NextResponse.json({ error: "Şəkil faylı oxunmadı" }, { status: 400 });
  }
  let form: FormData;
  const formBody = new ArrayBuffer(body.byteLength);
  new Uint8Array(formBody).set(body);
  try { form = await new Request(request.url, { method: "POST", headers: request.headers, body: formBody }).formData(); } catch { return NextResponse.json({ error: "Şəkil faylı oxunmadı" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Yükləmək üçün şəkil seçin" }, { status: 400 });
  if (file.size < 1 || file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Şəkil 5 MB-dan kiçik olmalıdır" }, { status: 413 });
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return NextResponse.json({ error: "Yalnız JPEG, PNG və WebP şəkilləri qəbul edilir" }, { status: 415 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validated = await validateAndNormalizeStoreImage(bytes, file.type, MAX_IMAGE_BYTES);
  if (!validated) return NextResponse.json({ error: "Fayl etibarlı JPEG, PNG və ya WebP şəkli deyil" }, { status: 415 });
  try {
    const asset = await getStoreAssetStorage().save(storeId, validated.bytes, validated.contentType);
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error && (error.message.includes("STORAGE") || error.message.includes("PRODUCTION_STORAGE"))
      ? "Şəkil yaddaşı sazlanmayıb. Davamlı S3 yaddaşı və server tərəfində etimadnamələr konfiqurasiya edilməlidir."
      : "Şəkil yadda saxlanıla bilmədi";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await requireStoreAccess(storeId);
  if (!access || access.user.role !== "VENDOR") return NextResponse.json({ error: "Mağazaya giriş icazəsi yoxdur" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Şəkil məlumatı yanlışdır" }, { status: 400 }); }
  const url = body && typeof body === "object" && "url" in body && typeof body.url === "string" ? body.url : "";
  const key = getOwnedStoreAssetKey(access.storeId, url);
  const urlDriver = getStoreAssetDriverForUrl(access.storeId, url);
  if (!key || !urlDriver) return NextResponse.json({ error: "Bu mağazaya aid şəkil tapılmadı" }, { status: 404 });
  const configuredDriver = activeStoreAssetDriver();
  if (configuredDriver !== urlDriver) return NextResponse.json({ error: "Şəkil cari yaddaş provayderində deyil" }, { status: 409 });

  const [storeReference, productReference, variantReference] = await Promise.all([
    isStorefrontAssetReferenced(access.storeId, url),
    prisma.product.findFirst({ where: { images: { has: url } }, select: { id: true } }),
    prisma.productVariant.findFirst({ where: { images: { has: url } }, select: { id: true } }),
  ]);
  if (storeReference || productReference || variantReference) return NextResponse.json({ error: "İstifadə olunan şəkli silməzdən əvvəl onu məhsuldan və mağaza profilindən çıxarın" }, { status: 409 });

  try {
    await getStoreAssetStorage().delete(access.storeId, key);
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ error: "Şəkil silinə bilmədi" }, { status: 503 });
  }
}
