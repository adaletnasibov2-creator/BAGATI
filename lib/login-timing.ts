import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

/** Same cost as every stored password hash (register, reset, password change, admin tools). */
export const LOGIN_DUMMY_BCRYPT_COST = 12;

let dummyHash: Promise<string> | null = null;

/** A bcrypt hash of a random value nobody knows, made once per process. */
export function loginDummyHash(): Promise<string> {
  dummyHash ??= bcrypt.hash(randomBytes(24).toString("base64url"), LOGIN_DUMMY_BCRYPT_COST);
  return dummyHash;
}

/**
 * SEC-FIX-1 L9: when the account is missing, inactive or has password sign-in turned off, the login routes still run
 * one bcrypt compare, so the response takes about as long as a wrong password and its timing does not reveal whether
 * the email has an account. Always false.
 */
export async function equalizeLoginTiming(password: string): Promise<false> {
  await bcrypt.compare(password, await loginDummyHash());
  return false;
}
