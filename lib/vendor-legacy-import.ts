import { z } from "zod";

/**
 * Body of POST /api/vendor/{storeId}/imports (validate / import up to 1000 rows parsed in the browser).
 *
 * SEC-FIX-1 M4: the server no longer parses uploaded file text. The old `fileText` field (up to 5,000,000 characters,
 * parsed server-side, XML with a quadratic regex) is gone, and the schema is strict, so a body that still sends
 * `fileText` (or any other unknown field) is rejected by zod before anything is parsed. The seller import wizard
 * (components/vendor-import.tsx) only sends the fields below.
 */
export const vendorLegacyImportBodySchema = z.object({
  action: z.enum(["validate", "import"]),
  mode: z.enum(["create", "update", "mixed"]).default("create"),
  sourceName: z.string().trim().min(1).max(255),
  mapping: z.record(z.string()),
  rows: z.array(z.record(z.unknown())).min(1).max(1000),
}).strict();
