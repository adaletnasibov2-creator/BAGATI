export type CatalogArchiveImage = { filename: string; sku: string; order: number; file: File };
export type CatalogImageMatch = { filename: string; sku: string; order: number; rowIndex: number; file: File };

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_IMAGES = 200;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function normalizeCatalogImageSku(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const sku = String(value).normalize("NFKC").replace(/^[\u0009-\u000D\u0020]+|[\u0009-\u000D\u0020]+$/g, "").replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
  return sku && !sku.includes("\u0000") ? sku : null;
}

function normalizeCatalogImageName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("az-AZ");
  return name && !name.includes("\u0000") ? name : null;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("IMAGE_ARCHIVE_DECOMPRESSION_UNAVAILABLE");
  const input = new Uint8Array(bytes);
  const stream = new Blob([input.buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("IMAGE_ARCHIVE_ENTRY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

export async function parseCatalogImageArchive(file: File): Promise<CatalogArchiveImage[]> {
  if (file.size < 22 || file.size > MAX_ARCHIVE_BYTES) throw new Error("IMAGE_ARCHIVE_SIZE_INVALID");
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new Error("IMAGE_ARCHIVE_INVALID");
  const disk = view.getUint16(end + 4, true);
  const centralDisk = view.getUint16(end + 6, true);
  const diskCount = view.getUint16(end + 8, true);
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  let cursor = view.getUint32(end + 16, true);
  const commentLength = view.getUint16(end + 20, true);
  if (disk || centralDisk || diskCount !== count || count > MAX_ARCHIVE_IMAGES || end + 22 + commentLength !== bytes.length || cursor + centralSize > end) {
    throw new Error("IMAGE_ARCHIVE_STRUCTURE_UNSUPPORTED");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const names = new Set<string>();
  const imageKeys = new Set<string>();
  const entries: CatalogArchiveImage[] = [];
  let expandedTotal = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("IMAGE_ARCHIVE_DIRECTORY_INVALID");
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const expectedCrc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const entryCommentLength = view.getUint16(cursor + 32, true);
    const madeBy = view.getUint16(cursor + 4, true) >>> 8;
    const externalAttributes = view.getUint32(cursor + 38, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const nameAt = cursor + 46;
    const next = nameAt + nameLength + extraLength + entryCommentLength;
    if (next > end) throw new Error("IMAGE_ARCHIVE_DIRECTORY_INVALID");
    let filename: string;
    try { filename = decoder.decode(bytes.slice(nameAt, nameAt + nameLength)); }
    catch { throw new Error("IMAGE_ARCHIVE_FILENAME_ENCODING_INVALID"); }
    cursor = next;
    if (flags & 1) throw new Error("IMAGE_ARCHIVE_ENCRYPTED_UNSUPPORTED");
    if (filename.endsWith("/")) continue;
    if (filename.includes("/") || filename.includes("\\") || filename === "." || filename === ".." || filename.includes("..")) throw new Error("IMAGE_ARCHIVE_PATH_UNSAFE");
    const lowerName = filename.toLocaleLowerCase("en-US");
    if (names.has(lowerName)) throw new Error("IMAGE_ARCHIVE_DUPLICATE_FILENAME");
    names.add(lowerName);
    if (madeBy === 3 && ((externalAttributes >>> 16) & 0xf000) === 0xa000) throw new Error("IMAGE_ARCHIVE_LINK_UNSUPPORTED");
    const match = /^(.+?)(?:__(\d{1,3}))?\.(jpe?g|png|webp)$/i.exec(filename);
    if (!match) throw new Error("IMAGE_ARCHIVE_FILENAME_INVALID");
    const sku = normalizeCatalogImageSku(match[1]);
    const order = match[2] ? Number(match[2]) : 1;
    if (!sku || order < 1 || order > 12) throw new Error("IMAGE_ARCHIVE_FILENAME_INVALID");
    const imageKey = `${sku}\u0000${order}`;
    if (imageKeys.has(imageKey)) throw new Error("IMAGE_ARCHIVE_DUPLICATE_SKU_IMAGE_ORDER");
    imageKeys.add(imageKey);
    if (!uncompressedSize || uncompressedSize > MAX_IMAGE_BYTES || compressedSize > MAX_ARCHIVE_BYTES || (method !== 0 && method !== 8)) throw new Error("IMAGE_ARCHIVE_ENTRY_SIZE_OR_METHOD_INVALID");
    expandedTotal += uncompressedSize;
    if (expandedTotal > MAX_UNCOMPRESSED_BYTES) throw new Error("IMAGE_ARCHIVE_TOTAL_UNPACKED_SIZE_EXCEEDED");
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("IMAGE_ARCHIVE_LOCAL_HEADER_INVALID");
    const localFlags = view.getUint16(localOffset + 6, true);
    const localMethod = view.getUint16(localOffset + 8, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (localFlags !== flags || localMethod !== method || dataOffset + compressedSize > bytes.length) throw new Error("IMAGE_ARCHIVE_LOCAL_HEADER_INVALID");
    const localName = decoder.decode(bytes.slice(localOffset + 30, localOffset + 30 + localNameLength));
    if (localName !== filename) throw new Error("IMAGE_ARCHIVE_LOCAL_FILENAME_MISMATCH");
    const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);
    const imageBytes = method === 0 ? compressed : await inflateRaw(compressed);
    if (imageBytes.byteLength !== uncompressedSize || crc32(imageBytes) !== expectedCrc) throw new Error("IMAGE_ARCHIVE_ENTRY_CORRUPT");
    const contentType = match[3].toLowerCase() === "png" ? "image/png" : match[3].toLowerCase() === "webp" ? "image/webp" : "image/jpeg";
    const fileBytes = new Uint8Array(imageBytes);
    entries.push({ filename, sku, order, file: new File([fileBytes.buffer as ArrayBuffer], filename, { type: contentType }) });
  }
  if (cursor !== view.getUint32(end + 16, true) + centralSize || !entries.length) throw new Error("IMAGE_ARCHIVE_EMPTY_OR_INVALID");
  entries.sort((left, right) => left.sku.localeCompare(right.sku) || left.order - right.order);
  return entries;
}

export function matchCatalogImagesToRows(
  entries: readonly CatalogArchiveImage[],
  rows: readonly Record<string, string>[],
  skuColumn: string | undefined,
  nameColumn?: string,
): { matches: CatalogImageMatch[]; unmatched: string[]; duplicates: string[] } {
  if (!skuColumn && !nameColumn) return { matches: [], unmatched: entries.map((entry) => entry.filename), duplicates: [] };
  const rowBySku = new Map<string, number>();
  const rowByName = new Map<string, number>();
  const duplicateNames = new Set<string>();
  const duplicates: string[] = [];
  rows.forEach((row, index) => {
    const sku = skuColumn ? normalizeCatalogImageSku(row[skuColumn]) : null;
    if (sku) {
      if (rowBySku.has(sku)) duplicates.push(`kod: ${sku}`);
      else rowBySku.set(sku, index);
    }
    const name = nameColumn ? normalizeCatalogImageName(row[nameColumn]) : null;
    if (name) {
      if (rowByName.has(name)) duplicateNames.add(name);
      else rowByName.set(name, index);
    }
  });
  const matches: CatalogImageMatch[] = [];
  const unmatched: string[] = [];
  for (const entry of entries) {
    let rowIndex = rowBySku.get(entry.sku);
    if (rowIndex === undefined) {
      const name = normalizeCatalogImageName(entry.sku);
      if (name && duplicateNames.has(name)) { duplicates.push(`ad: ${name}`); continue; }
      rowIndex = rowByName.get(name || "");
    }
    if (rowIndex === undefined) unmatched.push(entry.filename);
    else matches.push({ ...entry, rowIndex });
  }
  return { matches, unmatched, duplicates: [...new Set(duplicates)] };
}
