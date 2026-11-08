import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { CartPageClient } from "@/components/cart-page-client";

export const dynamic = "force-dynamic";

export default async function CartPage() {
  const user = await currentUser();
  if (!user || user.role !== "CUSTOMER") redirect("/login?next=%2Fcart");

  return <CartPageClient />;
}
