/** Geri ödənişlər (/admin/refunds): provider status note, plus cancelled store orders whose order was paid. */
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/format-money";
import { CANCELLATION_TEXT } from "@/lib/order-cancellation";
import { type SectionContext, card, Header, Table } from "./shared";

export async function renderRefunds({ shell }: SectionContext) {
  // "Refund needed": a store order cancelled (customer cancel, approved request, store or admin cancel) while the order
  // has a PAID payment, including a payment confirmed after the cancellation. Nothing is refunded automatically.
  const refundNeeded = await prisma.storeOrder.findMany({
    where: { status: "CANCELLED", order: { payments: { some: { status: "PAID" } } } },
    select: {
      id: true, subtotal: true, deliveryFee: true, createdAt: true,
      store: { select: { name: true } },
      order: { select: { id: true, user: { select: { email: true } } } },
      cancellationRequests: { where: { status: "APPROVED" }, orderBy: { decidedAt: "desc" }, take: 1, select: { decidedAt: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return shell(<>
    <Header title="Geri ödənişlər"/>
    <div className={card}><p className="font-medium">Xarici ödəniş provayderi qoşulmayıb</p><p className="mt-2 text-sm text-slate-500">Qaytarılma sorğuları mövcuddur, lakin geri ödəniş yalnız REFUND_PENDING vəziyyətində saxlanılır. Provayderdən təsdiq gəlmədən tamamlanmış geri ödəniş qeydi yaradılmır.</p></div>
    <section className="mt-5" data-refund-needed-list>
      <h2 className="mb-1 text-lg font-semibold">{CANCELLATION_TEXT.refundPending}</h2>
      <p className="mb-3 text-sm text-slate-500">Ləğv edilmiş, lakin ödənişi alınmış mağaza sifarişləri. Geri ödəniş əl ilə edilir; burada heç bir məbləğ avtomatik qaytarılmır.</p>
      <Table
        rows={refundNeeded}
        empty="Geri ödəniş gözləyən ləğv edilmiş sifariş yoxdur."
        columns={[
          { label: "Sifariş", cell: (row) => <Link href={`/admin/orders/${row.order.id}`} className="font-semibold text-[#173c40]">#{row.order.id.slice(-8).toUpperCase()}</Link> },
          { label: "Mağaza", cell: (row) => row.store.name },
          { label: "Müştəri", cell: (row) => row.order.user.email },
          { label: "Məbləğ", cell: (row) => formatMoney(Number(row.subtotal) + Number(row.deliveryFee)) },
          { label: "Ləğv", cell: (row) => row.cancellationRequests[0]?.decidedAt ? `Müştəri müraciəti · ${row.cancellationRequests[0].decidedAt.toLocaleDateString("az-AZ")}` : "Mağaza, admin və ya müştəri ləğvi" },
        ]}
      />
    </section>
  </>);
}
