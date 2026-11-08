import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const STORE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
const ASSET_NAME_PATTERN = /^[a-f0-9-]+\.(?:jpg|png|webp)$/i;
const CONTENT_TYPES = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

export async function GET(_request: Request, { params }: { params: Promise<{ storeId: string; assetName: string }> }) {
  const { storeId, assetName } = await params;
  if (!STORE_ID_PATTERN.test(storeId) || !ASSET_NAME_PATTERN.test(assetName)) return new NextResponse(null, { status: 404 });

  const root = path.resolve(process.cwd(), "public", "uploads", "vendors");
  const filePath = path.resolve(root, storeId, assetName);
  if (!filePath.startsWith(`${root}${path.sep}`)) return new NextResponse(null, { status: 404 });

  let image: Buffer;
  try {
    image = await readFile(filePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return new NextResponse(null, { status: 404 });
    throw error;
  }

  const extension = path.extname(assetName).slice(1).toLowerCase() as keyof typeof CONTENT_TYPES;
  const body = new Uint8Array(image.byteLength);
  body.set(image);
  return new NextResponse(body, {
    headers: {
      "Content-Type": CONTENT_TYPES[extension],
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
