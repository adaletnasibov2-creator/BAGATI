import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createLocalStoreAssetStorage, validateAndNormalizeStoreImage, withStorageSlot } from "../lib/storage/store-assets";

const levels = [5, 10, 25, 50];

async function main() {
const root = await mkdtemp(path.join(tmpdir(), "bagati-upload-probe-"));
const width = 640;
const height = 480;
const source = new Uint8Array(await sharp(randomBytes(width * height * 3), {
  raw: { width, height, channels: 3 },
}).jpeg({ quality: 80 }).toBuffer());

function percentile(samples: number[], ratio: number) {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

const results = [];
try {
  const storage = createLocalStoreAssetStorage(root);
  for (const concurrency of levels) {
    const started = performance.now();
    const before = process.memoryUsage();
    const durations: number[] = [];
    let success = 0;
    let failed = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      const one = performance.now();
      try {
        await withStorageSlot(async () => {
          const validated = await validateAndNormalizeStoreImage(source, "image/jpeg", 5 * 1024 * 1024);
          if (!validated) throw new Error("INVALID_IMAGE");
          await storage.save("probe-store", validated.bytes, validated.contentType);
        });
        success += 1;
      } catch {
        failed += 1;
      }
      durations.push(performance.now() - one);
    }));
    const after = process.memoryUsage();
    const result = {
      concurrency,
      success,
      failed,
      elapsedMs: Math.round(performance.now() - started),
      avgMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / Math.max(1, durations.length)),
      p95Ms: Math.round(percentile(durations, 0.95)),
      p99Ms: Math.round(percentile(durations, 0.99)),
      heapMb: Math.round(after.heapUsed / 1024 / 1024),
      rssMb: Math.round(after.rss / 1024 / 1024),
      rssDeltaMb: Math.round((after.rss - before.rss) / 1024 / 1024),
    };
    results.push(result);
    if (failed > 0 || result.rssMb > 1024) break;
  }
  console.log(JSON.stringify({
    environment: "local-temp-directory",
    imageBytes: source.byteLength,
    processLimit: process.env.BAGATI_STORAGE_PROCESS_LIMIT ?? "3",
    database: "not-used",
    provider: "local-temp",
    results,
  }));
} finally {
  await rm(root, { recursive: true, force: true });
}
}

main();
