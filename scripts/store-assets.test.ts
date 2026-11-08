import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import {
  activeStoreAssetDriver,
  createLocalStoreAssetStorage,
  createS3CompatibleStoreAssetStorage,
  getOwnedStoreAssetKey,
  getStoreAssetStorage,
  isOwnedStoreAssetUrl,
  isOwnedStoreAssetKey,
  storageProcessLimit,
  storageReadinessMode,
  validateAndNormalizeStoreImage,
  withStorageSlot,
  type S3AssetConfiguration,
  type StoreImageType,
} from "../lib/storage/store-assets";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const config: S3AssetConfiguration = {
  endpoint: "https://objects.example.test",
  region: "auto",
  bucket: "bagati-media",
  accessKeyId: "test-access",
  secretAccessKey: "test-secret-not-for-logs",
  publicBaseUrl: "https://cdn.example.test/bagati-assets",
};

async function image(type: StoreImageType) {
  const base = sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 30, g: 90, b: 120 } } });
  if (type === "image/jpeg") return new Uint8Array(await base.jpeg().toBuffer());
  if (type === "image/png") return new Uint8Array(await base.png().toBuffer());
  return new Uint8Array(await base.webp().toBuffer());
}

test("image validation matches declared MIME, decodes image content, and enforces size", async () => {
  const png = await image("image/png");
  const normalized = await validateAndNormalizeStoreImage(png, "image/png", 1_000_000);
  assert.ok(normalized);
  assert.equal(normalized.contentType, "image/png");
  assert.equal(await sharp(normalized.bytes).metadata().then(metadata => metadata.format), "png");
  assert.equal(await validateAndNormalizeStoreImage(png, "image/jpeg", 1_000_000), null);
  assert.equal(await validateAndNormalizeStoreImage(png, "image/png", png.length - 1), null);
  assert.equal(await validateAndNormalizeStoreImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), "image/png", 1_000_000), null);
});

test("S3 adapter writes durable store-scoped objects and returns public URLs", async () => {
  const previousPublicUrl = process.env.S3_PUBLIC_BASE_URL;
  process.env.S3_PUBLIC_BASE_URL = config.publicBaseUrl;
  let command: PutObjectCommand | DeleteObjectCommand | undefined;
  try {
    const storage = createS3CompatibleStoreAssetStorage(config, { send: async next => { command = next; return {}; } });
    const result = await storage.save("store_A-1", await image("image/webp"), "image/webp");
    assert.ok(command instanceof PutObjectCommand);
    assert.equal(command.input.Bucket, "bagati-media");
    assert.equal(command.input.ContentType, "image/webp");
    assert.equal(command.input.CacheControl, "public, max-age=31536000, immutable");
    assert.ok(typeof command.input.Body === "object");
    assert.match(result.key, /^vendors\/store_A-1\/[a-f0-9-]+\.webp$/i);
    assert.equal(result.url, `https://cdn.example.test/bagati-assets/${result.key}`);
    assert.equal(isOwnedStoreAssetKey("store_A-1", result.key), true);
    assert.equal(isOwnedStoreAssetKey("other-store", result.key), false);
    assert.equal(isOwnedStoreAssetUrl("store_A-1", result.url), true);
    assert.equal(isOwnedStoreAssetUrl("other-store", result.url), false);
    assert.equal(getOwnedStoreAssetKey("store_A-1", `${result.url}?unsafe=1`), null);
  } finally {
    if (previousPublicUrl === undefined) delete process.env.S3_PUBLIC_BASE_URL;
    else process.env.S3_PUBLIC_BASE_URL = previousPublicUrl;
  }
});

test("S3 deletion refuses foreign keys and deletes only the requested owned key", async () => {
  const commands: Array<PutObjectCommand | DeleteObjectCommand> = [];
  const storage = createS3CompatibleStoreAssetStorage(config, { send: async command => { commands.push(command); return {}; } });
  const key = "vendors/store-1/123e4567-e89b-12d3-a456-426614174000.jpg";
  await assert.rejects(storage.delete("store-2", key), /ASSET_NOT_OWNED/);
  assert.equal(commands.length, 0);
  await storage.delete("store-1", key);
  assert.ok(commands[0] instanceof DeleteObjectCommand);
  assert.equal(commands[0].input.Key, key);
  assert.equal(commands[0].input.Bucket, config.bucket);
});

test("S3 provider failures are sanitized and do not leak provider details", async () => {
  const storage = createS3CompatibleStoreAssetStorage(config, { send: async () => { throw new Error("private provider response and secret"); } });
  await assert.rejects(storage.save("store-1", await image("image/jpeg"), "image/jpeg"), (error: unknown) => {
    assert.equal(error instanceof Error ? error.message : "", "S3_ASSET_UPLOAD_FAILED");
    assert.equal(String(error).includes("private provider response"), false);
    assert.equal(String(error).includes(config.secretAccessKey), false);
    return true;
  });
  await assert.rejects(storage.delete("store-1", "vendors/store-1/123e4567-e89b-12d3-a456-426614174000.jpg"), (error: unknown) => {
    assert.equal(error instanceof Error ? error.message : "", "S3_ASSET_DELETE_FAILED");
    assert.equal(String(error).includes("private provider response"), false);
    return true;
  });
});

test("JPEG, PNG, and WebP pass signature checks and text or corrupted bytes do not", async () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"] as const) {
    const bytes = await image(type);
    const normalized = await validateAndNormalizeStoreImage(bytes, type, 1_000_000);
    assert.equal(normalized?.contentType, type);
  }
  const text = new Uint8Array(Buffer.from("not-an-image"));
  assert.equal(await validateAndNormalizeStoreImage(text, "image/png", 1_000_000), null);
  const broken = new Uint8Array(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11]));
  assert.equal(await validateAndNormalizeStoreImage(broken, "image/jpeg", 1_000_000), null);
});

test("local storage keeps a file across a new instance, replaces nothing, and deletes only the owned key", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bagati-storage-"));
  try {
    const storage = createLocalStoreAssetStorage(root);
    const first = await storage.save("store-1", new Uint8Array([1, 2, 3]), "image/webp");
    const second = await storage.save("store-1", new Uint8Array([4, 5, 6]), "image/webp");
    assert.notEqual(first.key, second.key);
    await assert.rejects(storage.save("../escape", new Uint8Array([1]), "image/png"), /INVALID_STORE_ID/);
    const reopened = createLocalStoreAssetStorage(root);
    assert.equal((await stat(path.join(root, ...first.key.split("/")))).isFile(), true);
    await assert.rejects(reopened.delete("store-2", first.key), /ASSET_NOT_OWNED/);
    await reopened.delete("store-1", first.key);
    await assert.rejects(stat(path.join(root, ...first.key.split("/"))), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    await reopened.delete("store-1", second.key);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a stored object is removed when the following database write fails", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bagati-storage-"));
  try {
    const storage = createLocalStoreAssetStorage(root);
    const saved = await storage.save("store-1", new Uint8Array([7]), "image/png");
    try {
      throw new Error("DATABASE_WRITE_FAILED");
    } catch (error) {
      assert.equal(error instanceof Error ? error.message : "", "DATABASE_WRITE_FAILED");
      await storage.delete("store-1", saved.key);
    }
    await assert.rejects(stat(path.join(root, ...saved.key.split("/"))), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("transient provider failures retry the same command and permanent failures do not", async () => {
  let attempts = 0;
  const retrying = createS3CompatibleStoreAssetStorage(config, {
    send: async () => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("socket reset");
        error.name = "TimeoutError";
        throw error;
      }
      return {};
    },
  });
  const saved = await retrying.save("store-1", await image("image/jpeg"), "image/jpeg");
  assert.equal(attempts, 3);
  assert.match(saved.key, /^vendors\/store-1\/[a-f0-9-]+\.jpg$/);

  let denied = 0;
  const permanent = createS3CompatibleStoreAssetStorage(config, {
    send: async () => {
      denied += 1;
      const error = new Error("private AccessDenied secret");
      error.name = "AccessDenied";
      throw error;
    },
  });
  await assert.rejects(permanent.save("store-1", await image("image/jpeg"), "image/jpeg"), /S3_ASSET_UPLOAD_FAILED/);
  assert.equal(denied, 1);
});

test("production storage fails closed until S3 or an explicit durable local volume is configured", () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    driver: process.env.BAGATI_STORAGE_DRIVER,
    durable: process.env.BAGATI_STORAGE_LOCAL_DURABLE,
    endpoint: process.env.S3_ENDPOINT,
  };
  try {
    Object.assign(process.env, { NODE_ENV: "production" });
    delete process.env.BAGATI_STORAGE_DRIVER;
    delete process.env.BAGATI_STORAGE_LOCAL_DURABLE;
    assert.throws(() => getStoreAssetStorage(), /STORE_ASSET_STORAGE_NOT_CONFIGURED/);
    assert.equal(storageReadinessMode(), "unconfigured");

    process.env.BAGATI_STORAGE_DRIVER = "local";
    assert.throws(() => getStoreAssetStorage(), /PRODUCTION_STORAGE_DRIVER_REQUIRED/);
    process.env.BAGATI_STORAGE_LOCAL_DURABLE = "true";
    assert.equal(activeStoreAssetDriver(), "local");
    assert.equal(storageReadinessMode(), "local");

    process.env.BAGATI_STORAGE_DRIVER = "s3";
    delete process.env.S3_ENDPOINT;
    assert.equal(storageReadinessMode(), "unconfigured");
    assert.throws(() => getStoreAssetStorage(), /S3_STORAGE_NOT_CONFIGURED/);

    Object.assign(process.env, { NODE_ENV: "development" });
    delete process.env.BAGATI_STORAGE_DRIVER;
    assert.equal(activeStoreAssetDriver(), "local");
    assert.equal(storageReadinessMode(), "local");
  } finally {
    const env = process.env as Record<string, string | undefined>;
    if (previous.NODE_ENV === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previous.NODE_ENV;
    if (previous.driver === undefined) delete process.env.BAGATI_STORAGE_DRIVER;
    else process.env.BAGATI_STORAGE_DRIVER = previous.driver;
    if (previous.durable === undefined) delete process.env.BAGATI_STORAGE_LOCAL_DURABLE;
    else process.env.BAGATI_STORAGE_LOCAL_DURABLE = previous.durable;
    if (previous.endpoint === undefined) delete process.env.S3_ENDPOINT;
    else process.env.S3_ENDPOINT = previous.endpoint;
  }
});

test("upload processing stays within the configured concurrency limit", async () => {
  const previous = process.env.BAGATI_STORAGE_PROCESS_LIMIT;
  process.env.BAGATI_STORAGE_PROCESS_LIMIT = "2";
  let running = 0;
  let peak = 0;
  try {
    assert.equal(storageProcessLimit(), 2);
    await Promise.all(Array.from({ length: 6 }, () => withStorageSlot(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;
    })));
    assert.equal(peak, 2);
  } finally {
    if (previous === undefined) delete process.env.BAGATI_STORAGE_PROCESS_LIMIT;
    else process.env.BAGATI_STORAGE_PROCESS_LIMIT = previous;
  }
});
