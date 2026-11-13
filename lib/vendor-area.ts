import { notFound, redirect } from "next/navigation";
import { currentUser, requireStoreAccess } from "@/lib/auth";

export { vendorAreaRedirectPath } from "@/lib/login-portal";

/**
 * Store-scoped seller pages: the store's owner continues. A signed-in CUSTOMER is sent to /vendor/apply;
 * anyone else gets a 404, so store ids are not confirmed to outsiders.
 */
export async function requireVendorStorePage(storeId: string) {
  const access = await requireStoreAccess(storeId);
  if (access) return access;
  const user = await currentUser();
  if (user?.role === "CUSTOMER") redirect("/vendor/apply");
  notFound();
}
