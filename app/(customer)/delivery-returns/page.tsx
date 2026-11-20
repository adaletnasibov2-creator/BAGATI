import { getSiteSettings } from "@/lib/site-settings";

export const dynamic = "force-dynamic";

export default async function DeliveryReturnsPage() {
  const settings = await getSiteSettings();
  // DESIGN-T9: tokens, Fraunces headings and calm cards; texts (settings or the built-in fallbacks) unchanged.
  const card = "rounded-card border border-line bg-white p-6 shadow-subtle sm:p-8";
  const text = "mt-4 whitespace-pre-wrap text-body leading-[1.8] text-fg-body";
  return <div className="container grid gap-5 py-8 md:py-12 lg:grid-cols-2 lg:items-start">
    <section className={card}>
      <h1 className="font-display text-h2 text-fg">Çatdırılma</h1>
      <p className={text}>{settings.deliveryInfo || "Çatdırılma şərtləri sifariş və mağazaya görə göstərilir."}</p>
    </section>
    <section className={card}>
      <h2 className="font-display text-h2 text-fg">Qaytarılma</h2>
      <p className={text}>{settings.returnsInfo || "Qaytarılma barədə məlumat mövcud deyil."}</p>
    </section>
  </div>;
}
