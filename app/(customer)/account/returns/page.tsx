import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { CustomerReturns } from "@/components/customer-returns";
import { AccountShell } from "@/components/account-shell";
import { customerMessagesBadge } from "@/lib/messaging-pages";

export const dynamic = "force-dynamic";

export default async function ReturnsPage() {
  const user = await currentUser();
  if (!user || user.role !== "CUSTOMER") redirect("/login?next=%2Faccount%2Freturns");
  const messagesUnread = await customerMessagesBadge(user.id);
  return <AccountShell title="Qaytarılma və dəyişdirilmə" messagesUnread={messagesUnread}><CustomerReturns/></AccountShell>;
}
