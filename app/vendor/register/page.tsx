import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";

/** Seller self-registration is closed: sellers register as customers, then apply at /vendor/apply. */
export default async function VendorRegisterPage() {
  const user = await currentUser();
  if (user?.role === "VENDOR") redirect("/vendor");
  redirect("/register?next=%2Fvendor%2Fapply");
}
