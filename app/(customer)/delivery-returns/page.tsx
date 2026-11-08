import { getSiteSettings } from "@/lib/site-settings";

export const dynamic = "force-dynamic";

export default async function DeliveryReturnsPage() {
  const settings = await getSiteSettings();
  return <div className="container grid gap-5 py-10 sm:py-14 lg:grid-cols-2">
    <section className="rounded-2xl border border-[#E8E7E2] bg-white p-6 sm:p-8">
      <h1 className="text-2xl font-semibold text-[#0B1726]">Çatdırılma</h1>
      <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-[#536273]">{settings.deliveryInfo || "Çatdırılma şərtləri sifariş və mağazaya görə göstərilir."}</p>
    </section>
    <section className="rounded-2xl border border-[#E8E7E2] bg-white p-6 sm:p-8">
      <h2 className="text-2xl font-semibold text-[#0B1726]">Qaytarılma</h2>
      <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-[#536273]">{settings.returnsInfo || "Qaytarılma barədə məlumat mövcud deyil."}</p>
    </section>
  </div>;
}
