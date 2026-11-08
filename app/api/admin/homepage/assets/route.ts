import { NextRequest, NextResponse } from "next/server";
import { csrfRejection } from "@/lib/csrf";
import { requireRole } from "@/lib/auth";
import { readBoundedRequestBytes } from "@/lib/request-body";
import { getStoreAssetStorage, validateAndNormalizeStoreImage, withStorageSlot } from "@/lib/storage/store-assets";
import { HOMEPAGE_ASSET_NAMESPACE } from "@/lib/site-content";

export const runtime = "nodejs";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FORM_BYTES = MAX_IMAGE_BYTES + 128 * 1024;

export async function POST(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  return withStorageSlot(() => storeHomepageAsset(request));
}

async function storeHomepageAsset(request: NextRequest) {
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

  const validated = await validateAndNormalizeStoreImage(new Uint8Array(await file.arrayBuffer()), file.type, MAX_IMAGE_BYTES);
  if (!validated) return NextResponse.json({ error: "Fayl etibarlı JPEG, PNG və ya WebP şəkli deyil" }, { status: 415 });
  try {
    const asset = await getStoreAssetStorage().save(HOMEPAGE_ASSET_NAMESPACE, validated.bytes, validated.contentType);
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error && (error.message.includes("STORAGE") || error.message.includes("PRODUCTION_STORAGE"))
      ? "Şəkil yaddaşı sazlanmayıb. Davamlı S3 yaddaşı və server tərəfində etimadnamələr konfiqurasiya edilməlidir."
      : "Şəkil yadda saxlanıla bilmədi";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
