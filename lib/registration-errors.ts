import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";

type ExistingRegistrationAccount = {
  id: string;
  passwordHash: string;
  role: Role;
  emailVerifiedAt: Date | null;
};

export function isDuplicateEmailError(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") return false;
  const meta = "meta" in error && error.meta && typeof error.meta === "object" ? error.meta : null;
  const target = meta && "target" in meta ? meta.target : null;
  const fields = Array.isArray(target) ? target : typeof target === "string" ? [target] : [];
  return fields.some((field) => typeof field === "string" && (field === "email" || field.includes("User_email_key") || field.includes("User_email_normalized_key")));
}

export async function resumableRegistrationUserId(account: ExistingRegistrationAccount | null, password: string, role: Role) {
  if (!account || account.role !== role || account.emailVerifiedAt !== null) return null;
  return await bcrypt.compare(password, account.passwordHash) ? account.id : null;
}
