import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type StoreImageType = "image/jpeg" | "image/png" | "image/webp";
export type StoredStoreAsset = { key: string; url: string };

const STORE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
const OBJECT_KEY_PATTERN = /^vendors\/([a-zA-Z0-9_-]{1,80})\/([a-f0-9-]+\.(?:jpg|png|webp))$/i;
const IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const S3_RETRY_DELAYS_MS = [0, 250, 750];
const DEFAULT_UPLOAD_ROOT = path.resolve(process.cwd(), "public", "uploads");

export function isOwnedStoreAssetKey(storeId: string, key: string): boolean {
  const match = OBJECT_KEY_PATTERN.exec(key);
  return Boolean(match && match[1] === storeId);
}

function publicBaseUrl(): URL | null {
  const raw = process.env.S3_PUBLIC_BASE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

export function getOwnedStoreAssetKey(storeId: string, assetUrl: string): string | null {
  if (!STORE_ID_PATTERN.test(storeId)) return null;
  const escaped = storeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const local = new RegExp(`^/uploads/vendors/${escaped}/[a-f0-9-]+\\.(?:jpg|png|webp)$`, "i").exec(assetUrl);
  if (local) return `vendors/${storeId}/${assetUrl.slice(assetUrl.lastIndexOf("/") + 1)}`;

  const base = publicBaseUrl();
  if (!base) return null;
  let candidate: URL;
  try { candidate = new URL(assetUrl); } catch { return null; }
  if (candidate.origin !== base.origin || candidate.search || candidate.hash || candidate.username || candidate.password) return null;
  const prefix = base.pathname.replace(/\/+$/, "");
  const pathPrefix = `${prefix}/`;
  if (!candidate.pathname.startsWith(pathPrefix)) return null;
  const key = candidate.pathname.slice(pathPrefix.length);
  return isOwnedStoreAssetKey(storeId, key) ? key : null;
}

export function isOwnedStoreAssetUrl(storeId: string, url: string): boolean {
  return getOwnedStoreAssetKey(storeId, url) !== null;
}

export function getStoreAssetDriverForUrl(storeId: string, assetUrl: string): "local" | "s3" | null {
  if (!getOwnedStoreAssetKey(storeId, assetUrl)) return null;
  return assetUrl.startsWith("/") ? "local" : "s3";
}

export interface StoreAssetStorage {
  save(storeId: string, bytes: Uint8Array, contentType: StoreImageType): Promise<StoredStoreAsset>;
  delete(storeId: string, key: string): Promise<void>;
}

function fileExtension(contentType: StoreImageType) {
  return contentType === "image/jpeg" ? "jpg" : contentType === "image/png" ? "png" : "webp";
}

class LocalPublicAssetStorage implements StoreAssetStorage {
  constructor(private readonly root = DEFAULT_UPLOAD_ROOT) {}

  async save(storeId: string, bytes: Uint8Array, contentType: StoreImageType): Promise<StoredStoreAsset> {
    if (!STORE_ID_PATTERN.test(storeId)) throw new Error("INVALID_STORE_ID");
    const key = `vendors/${storeId}/${randomUUID()}.${fileExtension(contentType)}`;
    const destination = path.resolve(this.root, ...key.split("/"));
    if (!destination.startsWith(`${this.root}${path.sep}`)) throw new Error("INVALID_ASSET_PATH");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx" });
    return { key, url: `/uploads/${key}` };
  }

  async delete(storeId: string, key: string): Promise<void> {
    if (!isOwnedStoreAssetKey(storeId, key)) throw new Error("ASSET_NOT_OWNED");
    const destination = path.resolve(this.root, ...key.split("/"));
    if (!destination.startsWith(`${this.root}${path.sep}`)) throw new Error("INVALID_ASSET_PATH");
    try { await unlink(destination); } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
      throw new Error("LOCAL_ASSET_DELETE_FAILED");
    }
  }
}

export function createLocalStoreAssetStorage(root = DEFAULT_UPLOAD_ROOT): StoreAssetStorage {
  return new LocalPublicAssetStorage(path.resolve(root));
}

export type S3AssetConfiguration = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  publicBaseUrl: string;
};

export function getS3AssetConfiguration(): S3AssetConfiguration {
  const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_SESSION_TOKEN, S3_PUBLIC_BASE_URL } = process.env;
  if (!S3_ENDPOINT?.trim() || !S3_REGION?.trim() || !S3_BUCKET?.trim() || !S3_ACCESS_KEY_ID?.trim() || !S3_SECRET_ACCESS_KEY || !S3_PUBLIC_BASE_URL?.trim()) {
    throw new Error("S3_STORAGE_NOT_CONFIGURED");
  }
  let endpoint: URL;
  let publicUrl: URL;
  try {
    endpoint = new URL(S3_ENDPOINT);
    publicUrl = new URL(S3_PUBLIC_BASE_URL);
  } catch {
    throw new Error("S3_STORAGE_NOT_CONFIGURED");
  }
  const isLocalEndpoint = ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname);
  if (!['http:', 'https:'].includes(endpoint.protocol) || (process.env.NODE_ENV === "production" && (!isLocalEndpoint && endpoint.protocol !== "https:"))) throw new Error("S3_STORAGE_NOT_CONFIGURED");
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/i.test(S3_BUCKET)) throw new Error("S3_STORAGE_NOT_CONFIGURED");
  if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || (process.env.NODE_ENV === "production" && publicUrl.protocol !== "https:")) throw new Error("S3_STORAGE_NOT_CONFIGURED");
  return {
    endpoint: endpoint.toString(),
    region: S3_REGION.trim(),
    bucket: S3_BUCKET.trim(),
    accessKeyId: S3_ACCESS_KEY_ID.trim(),
    secretAccessKey: S3_SECRET_ACCESS_KEY,
    ...(S3_SESSION_TOKEN?.trim() ? { sessionToken: S3_SESSION_TOKEN.trim() } : {}),
    publicBaseUrl: publicUrl.toString(),
  };
}

type S3CommandClient = { send(command: PutObjectCommand | DeleteObjectCommand): Promise<unknown> };

export class S3CompatibleStoreAssetStorage implements StoreAssetStorage {
  private readonly client: S3CommandClient;
  private readonly publicBase: URL;

  constructor(private readonly config: S3AssetConfiguration, client?: S3CommandClient) {
    const endpoint = new URL(config.endpoint);
    const publicBase = new URL(config.publicBaseUrl);
    const isLocalEndpoint = ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname);
    if (process.env.NODE_ENV === "production" && endpoint.protocol !== "https:" && !isLocalEndpoint) throw new Error("S3_STORAGE_NOT_CONFIGURED");
    if (process.env.NODE_ENV === "production" && publicBase.protocol !== "https:") throw new Error("S3_STORAGE_NOT_CONFIGURED");
    this.publicBase = publicBase;
    this.client = client ?? new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      maxAttempts: 1,
      requestHandler: new NodeHttpHandler({ connectionTimeout: 5_000, requestTimeout: 30_000 }),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
      },
    });
  }

  async save(storeId: string, bytes: Uint8Array, contentType: StoreImageType): Promise<StoredStoreAsset> {
    if (!STORE_ID_PATTERN.test(storeId)) throw new Error("INVALID_STORE_ID");
    const key = `vendors/${storeId}/${randomUUID()}.${fileExtension(contentType)}`;
    await sendStorageCommand(this.client, new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: bytes,
      ContentLength: bytes.byteLength,
      ContentType: contentType,
      CacheControl: IMAGE_CACHE_CONTROL,
    }), "S3_ASSET_UPLOAD_FAILED");
    const base = this.publicBase.toString().replace(/\/+$/, "");
    return { key, url: `${base}/${key}` };
  }

  async delete(storeId: string, key: string): Promise<void> {
    if (!isOwnedStoreAssetKey(storeId, key)) throw new Error("ASSET_NOT_OWNED");
    await sendStorageCommand(this.client, new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }), "S3_ASSET_DELETE_FAILED");
  }
}

function isRetryableStorageError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  if (name === "TimeoutError" || name === "NetworkingError" || name === "AbortError") return true;
  const code = "code" in error ? String(error.code) : "";
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EAI_AGAIN" || code === "ECONNREFUSED") return true;
  const metadata = "$metadata" in error ? error.$metadata : undefined;
  const status = metadata && typeof metadata === "object" && "httpStatusCode" in metadata ? Number(metadata.httpStatusCode) : Number.NaN;
  return status === 429 || (status >= 500 && status <= 599);
}

async function sendStorageCommand(client: S3CommandClient, command: PutObjectCommand | DeleteObjectCommand, failureCode: string) {
  for (let attempt = 0; attempt < S3_RETRY_DELAYS_MS.length; attempt += 1) {
    if (S3_RETRY_DELAYS_MS[attempt] > 0) await new Promise((resolve) => setTimeout(resolve, S3_RETRY_DELAYS_MS[attempt]));
    try {
      return await client.send(command);
    } catch (error) {
      if (!isRetryableStorageError(error) || attempt === S3_RETRY_DELAYS_MS.length - 1) throw new Error(failureCode);
    }
  }
  throw new Error(failureCode);
}

export function createS3CompatibleStoreAssetStorage(config: S3AssetConfiguration, client?: S3CommandClient) {
  return new S3CompatibleStoreAssetStorage(config, client);
}

let cachedS3Storage: S3CompatibleStoreAssetStorage | undefined;
let activeUploads = 0;
const uploadWaiters: Array<() => void> = [];

export function activeStoreAssetDriver(): string {
  return configuredStorageDriver();
}

function configuredStorageDriver(): string {
  const configured = process.env.BAGATI_STORAGE_DRIVER?.trim();
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? "" : "local";
}

export type StorageReadiness = "local" | "s3" | "unconfigured";

/** Reports which storage mode is active. It does not include endpoints, bucket names, or credentials. */
export function storageReadinessMode(): StorageReadiness {
  const driver = configuredStorageDriver();
  if (driver === "s3") {
    const required = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PUBLIC_BASE_URL"] as const;
    return required.every((key) => Boolean(process.env[key]?.trim())) ? "s3" : "unconfigured";
  }
  if (driver === "local") {
    if (process.env.NODE_ENV === "production" && process.env.BAGATI_STORAGE_LOCAL_DURABLE !== "true") return "unconfigured";
    return "local";
  }
  return "unconfigured";
}

export function storageProcessLimit(): number {
  const raw = Number(process.env.BAGATI_STORAGE_PROCESS_LIMIT ?? "3");
  if (!Number.isInteger(raw) || raw < 1 || raw > 8) return 3;
  return raw;
}

export async function withStorageSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeUploads >= storageProcessLimit()) {
    await new Promise<void>((resolve) => { uploadWaiters.push(resolve); });
  }
  activeUploads += 1;
  try {
    return await work();
  } finally {
    activeUploads -= 1;
    uploadWaiters.shift()?.();
  }
}

export function getStoreAssetStorage(): StoreAssetStorage {
  const provider = configuredStorageDriver();
  if (provider === "s3") return cachedS3Storage ??= new S3CompatibleStoreAssetStorage(getS3AssetConfiguration());
  if (provider !== "local") throw new Error("STORE_ASSET_STORAGE_NOT_CONFIGURED");
  if (process.env.NODE_ENV === "production" && process.env.BAGATI_STORAGE_LOCAL_DURABLE !== "true") throw new Error("PRODUCTION_STORAGE_DRIVER_REQUIRED");
  return createLocalStoreAssetStorage();
}

export function detectImageType(bytes: Uint8Array): StoreImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export async function validateAndNormalizeStoreImage(bytes: Uint8Array, declaredType: string, maxBytes: number): Promise<{ bytes: Uint8Array; contentType: StoreImageType } | null> {
  if (bytes.length < 1 || bytes.length > maxBytes) return null;
  const detected = detectImageType(bytes);
  if (!detected || declaredType !== detected) return null;
  return normalizeDetectedImage(bytes, detected, maxBytes);
}

async function normalizeDetectedImage(bytes: Uint8Array, detected: StoreImageType, maxBytes: number): Promise<{ bytes: Uint8Array; contentType: StoreImageType } | null> {
  try {
    const sharp = (await import("sharp")).default;
    const image = sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000, animated: false });
    const metadata = await image.metadata();
    if (metadata.format !== detected.split("/")[1].replace("jpeg", "jpeg") || !metadata.width || !metadata.height || metadata.pages && metadata.pages > 1) return null;
    let pipeline = image.rotate();
    if (detected === "image/jpeg") pipeline = pipeline.jpeg({ quality: 88, mozjpeg: true });
    else if (detected === "image/png") pipeline = pipeline.png({ compressionLevel: 8, adaptiveFiltering: true });
    else pipeline = pipeline.webp({ quality: 88 });
    const normalized = await pipeline.toBuffer();
    if (!normalized.length || normalized.length > maxBytes || detectImageType(normalized) !== detected) return null;
    return { bytes: new Uint8Array(normalized), contentType: detected };
  } catch {
    return null;
  }
}
