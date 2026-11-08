# Vendor asset storage

Vendor product, variant, and store-logo images use the `StoreAssetStorage` server-side boundary. Image URLs are stored in the existing `Store.logoUrl`, `Product.images`, and `ProductVariant.images` fields. Object keys use `vendors/<storeId>/<random-id>.<extension>` so ownership can be checked from the URL before product/profile updates or deletes.

## Local development

The default outside production is local storage at `public/uploads/vendors/<storeId>`. That directory is outside `.next`, so files remain after a restart of `npm run dev`. Production local storage is rejected unless both `BAGATI_STORAGE_DRIVER=local` and `BAGATI_STORAGE_LOCAL_DURABLE=true`. Set the durable flag only when `public/uploads` is a durable shared volume served by every application instance. Do not copy that flag to hosted production; hosted production must use `BAGATI_STORAGE_DRIVER=s3`.

`npm run dev` does not need cloud credentials. `npm run start` sets `NODE_ENV=production`, so it uses the same fail-closed rule as a deployed server. A local production-mode process can opt in with the durable flag above. Restart the process after changing the variables.

## S3-compatible production setup

Set these server-only variables in the deployment environment or an uncommitted local `.env`. Do not add credentials to `NEXT_PUBLIC_*` variables or client code.

```env
BAGATI_STORAGE_DRIVER=s3
S3_ENDPOINT=https://<provider-s3-api-endpoint>
S3_REGION=<provider-region-or-auto>
S3_BUCKET=<bucket-name>
S3_ACCESS_KEY_ID=<server-access-key>
S3_SECRET_ACCESS_KEY=<server-secret-key>
S3_SESSION_TOKEN=<optional-temporary-session-token>
S3_PUBLIC_BASE_URL=https://<cdn-or-public-domain>/<optional-bucket-root-prefix>
```

`S3_SESSION_TOKEN` is optional. `S3_ENDPOINT` is the provider's S3 API endpoint; `S3_PUBLIC_BASE_URL` is the public HTTPS URL mapped to the bucket root (the application appends the object key). Keep the bucket private. Point `S3_PUBLIC_BASE_URL` at a CDN hostname that is allowed to read the bucket. The API credentials are used only by the Node.js server and are never returned to the browser or logged. The S3 client uses path-style addressing, a 5 second connection timeout, and a 30 second request timeout. Transient network failures, HTTP 429, and HTTP 5xx responses are retried up to three times against the same object key. Authentication and other permanent errors are not retried. Each object is stored once, with `Cache-Control: public, max-age=31536000, immutable`, because the key is a new random id. Replacing an image uploads a new key and updates the URL stored on the product. No thumbnail set is generated: the 5 MiB limit and a single re-encoded JPEG, PNG, or WebP keep CPU and storage proportional to the seller's upload.

Cloudflare R2 is the preferred production provider while the site stays on Cloudflare. Use `S3_REGION=auto`, the account S3 endpoint as `S3_ENDPOINT`, and the public CDN hostname as `S3_PUBLIC_BASE_URL`. AWS S3 with CloudFront uses the same variables. MinIO is appropriate only with a durable volume and its own backups.

One Node process normalizes at most `BAGATI_STORAGE_PROCESS_LIMIT` images at a time (default 3, maximum 8). The request body is capped at 5 MiB plus 128 KiB, which is a tighter bound than a streaming parser for this size. `GET /api/ready` adds `storage` as `local`, `s3`, or `unconfigured` and does not include credentials. `GET /api/health` stays a process liveness check.

Upload the object before the product form saves its URL. If the seller never saves the product, the object can remain unreferenced. Do not run a bucket-wide delete to clean those objects. Remove an unreferenced object through the vendor delete API, which refuses a URL still stored on a logo, product, or variant.

To rotate credentials, create a new least-privilege key, update the host secret store, restart the web process, then disable the old key. To move providers, copy the `vendors/` prefix to the new bucket, set the new endpoint and public base URL, and keep the old bucket until stored URLs have been checked. A provider outage leaves existing CDN URLs readable when the CDN still has the object; new uploads return HTTP 503 until the provider accepts `PutObject` again.

Use a least-privilege access key limited to the configured bucket and `vendors/*` object prefix, with `PutObject` and `DeleteObject` permissions. Configure the bucket/CDN CORS policy only if browser image display requires it; uploads are proxied through BAGATI and do not need browser access to the S3 API. Require HTTPS for public and provider URLs in production (local development endpoints may use HTTP).

## Upload validation and deletion

The server first checks store ownership with `requireStoreAccess`, enforces a 5 MiB limit and declared MIME type, checks the file signature, then decodes and re-encodes JPEG, PNG, or WebP with Sharp. Unsupported, mismatched, malformed, animated, oversized, or over-40-megapixel inputs are rejected. Re-encoding removes source metadata. Storage failures return an error; the API never reports an upload as successful unless the provider's `PutObject` request succeeds.

The vendor asset DELETE API requires ownership of the route's store and a URL whose key belongs to that exact store. It refuses deletion while a store logo, product, or variant still references the URL. No permanent product/store data is deleted as part of this operation.

## Verification

Run `npm.cmd run test:store-assets` for image-decoding, URL ownership, S3 command, provider-failure, and delete-scope tests. `npm.cmd run test:auth:integration` verifies cross-store upload and delete requests are rejected. Tests use generated image bytes and mocked S3 commands; they do not require provider credentials and do not prove a live upload. A live provider check requires a configured bucket/CDN and an authorized vendor session.
