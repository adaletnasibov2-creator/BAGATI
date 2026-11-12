/**
 * READ-ONLY audit of stored store phone numbers. Prints counts only, never a phone number.
 *
 *   BAGATI_AUDIT_DATABASE_URL=<url> npx tsx scripts/audit-store-phones.ts
 *
 * It reads ONLY BAGATI_AUDIT_DATABASE_URL (never DATABASE_URL or .env) and runs a single SELECT.
 * Categories:
 *   empty          — no phone stored
 *   e164           — already stored as +994XXXXXXXXX (what new saves produce)
 *   normalizable   — valid Azerbaijani number in another format; shown correctly on the public page
 *                    already, and re-saved as E.164 the next time the seller/admin saves the profile
 *   invalid        — cannot be normalized; the public page hides WhatsApp and the phone link, and the
 *                    next profile save asks for a valid number
 * Of e164 + normalizable, "mobile" ones get the WhatsApp button.
 */
import { PrismaClient } from "@prisma/client";
import { normalizeAzPhone } from "../lib/az-phone";

async function main() {
  const url = process.env.BAGATI_AUDIT_DATABASE_URL;
  if (!url) throw new Error("Set BAGATI_AUDIT_DATABASE_URL to the database to audit (read-only).");
  const database = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const rows = await prisma.store.findMany({ select: { contactPhone: true } });
    const counts = { stores: rows.length, empty: 0, e164: 0, normalizable: 0, invalid: 0, mobile: 0 };
    for (const { contactPhone } of rows) {
      if (!contactPhone?.trim()) { counts.empty += 1; continue; }
      const normalized = normalizeAzPhone(contactPhone);
      if (!normalized) { counts.invalid += 1; continue; }
      if (normalized.mobile) counts.mobile += 1;
      if (contactPhone === normalized.e164) counts.e164 += 1;
      else counts.normalizable += 1;
    }
    console.log(JSON.stringify({ database, ...counts }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Audit failed.");
  process.exitCode = 1;
});
