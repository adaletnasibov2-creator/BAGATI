import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { CustomerReturns } from "@/components/customer-returns";

export const dynamic = "force-dynamic";

export default async function ReturnsPage() {
  const user = await currentUser();
  if (!user || user.role !== "CUSTOMER") redirect("/login?next=%2Faccount%2Freturns");
  return <main className="container py-8 sm:py-10"><p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald">Hesabım</p><h1 className="mt-2 text-3xl font-semibold text-ink">Qaytarılma və dəyişdirilmə</h1><div className="mt-6"><CustomerReturns/></div></main>;
}
