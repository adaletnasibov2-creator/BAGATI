import assert from "node:assert/strict";
import test from "node:test";
import { matchCatalogImagesToRows, parseCatalogImageArchive } from "../lib/catalog-image-archive.ts";

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const { name, data } of files) {
    const filename = encoder.encode(name);
    const content = encoder.encode(data);
    const checksum = crc32(content);
    const local = new Uint8Array(30 + filename.length + content.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x800, true);
    lv.setUint16(8, 0, true); lv.setUint32(14, checksum, true); lv.setUint32(18, content.length, true); lv.setUint32(22, content.length, true);
    lv.setUint16(26, filename.length, true); local.set(filename, 30); local.set(content, 30 + filename.length);
    const central = new Uint8Array(46 + filename.length); const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 0x0314, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true);
    cv.setUint16(10, 0, true); cv.setUint32(16, checksum, true); cv.setUint32(20, content.length, true); cv.setUint32(24, content.length, true);
    cv.setUint16(28, filename.length, true); cv.setUint32(42, offset, true); central.set(filename, 46);
    localParts.push(local); centralParts.push(central); offset += local.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  return new File([...localParts, ...centralParts, end], "images.zip", { type: "application/zip" });
}

test("ZIP images map by exact normalized SKU and ordered filename convention", async () => {
  const archive = storedZip([{ name: "SKU-1.png", data: "one" }, { name: "SKU-1__2.webp", data: "two" }, { name: "sku-2.jpg", data: "three" }]);
  const entries = await parseCatalogImageArchive(archive);
  const result = matchCatalogImagesToRows(entries, [{ sku: " SKU-1 " }, { sku: "SKU-2" }], "sku");
  assert.deepEqual(result.matches.map((image) => [image.rowIndex, image.order]), [[0, 1], [0, 2], [1, 1]]);
  assert.deepEqual(result.unmatched, []);
  assert.deepEqual(result.duplicates, []);
});

test("ZIP parser rejects path traversal and duplicate SKU image order", async () => {
  await assert.rejects(parseCatalogImageArchive(storedZip([{ name: "../SKU-1.png", data: "x" }])), /IMAGE_ARCHIVE_PATH_UNSAFE/);
  await assert.rejects(parseCatalogImageArchive(storedZip([{ name: "SKU-1.png", data: "x" }, { name: "sku-1__1.PNG", data: "y" }])), /IMAGE_ARCHIVE_DUPLICATE_SKU_IMAGE_ORDER/);
});

test("ZIP image matching reports unmatched images and duplicate spreadsheet SKUs", async () => {
  const entries = await parseCatalogImageArchive(storedZip([{ name: "SKU-1.png", data: "one" }, { name: "missing.png", data: "two" }]));
  const result = matchCatalogImagesToRows(entries, [{ sku: "SKU-1" }, { sku: "sku-1" }], "sku");
  assert.deepEqual(result.unmatched, ["missing.png"]);
  assert.deepEqual(result.duplicates, ["kod: sku-1"]);
});

test("ZIP images can match a unique product name when no product code is supplied", async () => {
  const entries = await parseCatalogImageArchive(storedZip([{ name: "Qara köynək.png", data: "one" }]));
  const result = matchCatalogImagesToRows(entries, [{ name: "  Qara   köynək " }, { name: "Ağ köynək" }], undefined, "name");
  assert.deepEqual(result.matches.map((image) => image.rowIndex), [0]);
  assert.deepEqual(result.unmatched, []);
  assert.deepEqual(result.duplicates, []);
});

test("ZIP name matching refuses ambiguous duplicate names rather than guessing", async () => {
  const entries = await parseCatalogImageArchive(storedZip([{ name: "Qara köynək.png", data: "one" }]));
  const result = matchCatalogImagesToRows(entries, [{ name: "Qara köynək" }, { name: "qara köynək" }], undefined, "name");
  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.unmatched, []);
  assert.deepEqual(result.duplicates, ["ad: qara köynək"]);
});
