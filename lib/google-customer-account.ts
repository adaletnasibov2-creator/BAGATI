import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { enqueueEmail } from "@/lib/email-outbox";
import type { GoogleIdentity } from "@/lib/google-oauth";
import { recordAcceptance } from "@/lib/legal-acceptance";
import { prisma } from "@/lib/prisma";

/** The only part of the database client the creation needs (a stand-in replaces it in unit tests). */
export type GoogleCustomerAccountDb = Pick<typeof prisma, "$transaction">;

/**
 * SIGNUP-EASY-2: the ONE place that creates an account from a verified Google identity. Used by the Google callback
 * (terms ticked on /register before Google) and by POST /api/auth/google/complete-register (terms ticked after Google,
 * pending sign-up cookie). Callers must have decided that no account with this e-mail or Google id exists and that
 * the current customer terms were accepted; the unique indexes on User.email and GoogleAccount.googleSub still refuse
 * a concurrent duplicate (the transaction then fails and nothing is written).
 *
 * Always role CUSTOMER, password sign-in off (a random hash nobody knows), e-mail verified now (Google verified it),
 * CustomerProfile + Cart, the GoogleAccount link, the WELCOME_CUSTOMER e-mail and the REGISTER_GOOGLE acceptance of
 * the current customer terms, all in one transaction.
 */
export async function createGoogleCustomerAccount(db: GoogleCustomerAccountDb, identity: GoogleIdentity): Promise<{ id: string }> {
  const displayName = [identity.givenName, identity.familyName].filter(Boolean).join(" ") || identity.name || identity.email.split("@")[0];
  const firstName = identity.givenName || identity.name.split(/\s+/)[0] || "";
  const lastName = identity.familyName || identity.name.split(/\s+/).slice(1).join(" ");
  const passwordHash = await bcrypt.hash(randomBytes(48).toString("base64url"), 12);
  return db.$transaction(async transaction => {
    const created = await transaction.user.create({
      data: {
        email: identity.email,
        passwordHash,
        passwordAuthEnabled: false,
        role: "CUSTOMER",
        isActive: true,
        // Only identities whose e-mail Google has verified reach this function (exchangeGoogleCode / the signed cookie).
        emailVerifiedAt: new Date(),
        customerProfile: { create: { firstName: firstName.slice(0, 80), lastName: lastName.slice(0, 80) } },
        cart: { create: {} },
      },
      select: { id: true },
    });
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "GoogleAccount" ("id", "googleSub", "userId", "createdAt")
      VALUES (${randomBytes(18).toString("base64url")}, ${identity.sub}, ${created.id}, ${new Date()})
    `);
    await enqueueEmail(transaction, {
      eventKey: `google-welcome:${created.id}`,
      recipient: identity.email,
      template: "WELCOME_CUSTOMER",
      payload: { name: displayName },
    });
    // Callers reach this only after the current terms version was accepted (signed OAuth state or acceptTerms === true).
    await recordAcceptance(transaction, { userId: created.id, document: "CUSTOMER_TERMS", source: "REGISTER_GOOGLE" });
    return created;
  });
}
