import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail, MessageCircle, Phone } from "lucide-react";
import VendorInquiryReadButton from "@/components/vendor-inquiry-actions";
import { normalizeAzPhone } from "@/lib/az-phone";
import { requireVendorStorePage } from "@/lib/vendor-area";
import { prisma } from "@/lib/prisma";
import { VendorPageHeader } from "@/components/vendor-page-header";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("az-AZ", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Baku" });

/** Seller inbox: buyer messages sent from the public store page. Works without SMTP; email is only a notification. */
export default async function VendorInquiriesPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await requireVendorStorePage(storeId);
  if (!access) notFound();
  const [store, inquiries, unread] = await Promise.all([
    prisma.store.findUnique({ where: { id: access.storeId }, select: { name: true, contactEmail: true } }),
    prisma.storeInquiry.findMany({
      where: { storeId: access.storeId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, name: true, contactEmail: true, contactPhone: true, message: true, status: true, createdAt: true },
    }),
    prisma.storeInquiry.count({ where: { storeId: access.storeId, status: "NEW" } }),
  ]);
  if (!store) notFound();

  return <div className="space-y-5">
    <VendorPageHeader
      eyebrow="Alıcı mesajları"
      title="Mesajlar"
      description={`${unread ? `${unread} yeni mesaj` : "Yeni mesaj yoxdur"} · son ${inquiries.length} mesaj göstərilir`}
      action={unread > 0 ? <VendorInquiryReadButton storeId={storeId} label="Hamısını oxunmuş et"/> : undefined}
    />
    <section className="rounded-card border border-line bg-white p-4 sm:p-5">
      <p className="text-xs leading-5 text-fg-secondary">
        Alıcılar mağaza səhifəsindəki “Mesaj yaz” forması ilə yazır. Mağazanızın e-poçt ünvanı alıcılara göstərilmir.
        {store.contactEmail
          ? <> Yeni mesaj barədə bildiriş <b>{store.contactEmail}</b> ünvanına göndərilir (e-poçt göndərişi sistemdə qurulduqdan sonra).</>
          : <> E-poçt bildirişi almaq üçün <Link href={`/vendor/${storeId}/profile`} className="font-medium text-[#173c40] underline">mağaza profilində</Link> bildiriş e-poçtunu yazın.</>}
        {" "}Bütün mesajlar e-poçtdan asılı olmayaraq burada saxlanılır.
      </p>
    </section>

    {inquiries.length === 0
      ? <section className="rounded-card border border-dashed border-line-strong bg-white p-8 text-center">
        <MessageCircle aria-hidden="true" className="mx-auto text-[#b89758]" size={28}/>
        <h2 className="mt-3 font-semibold text-[#142d38]">Hələ mesaj yoxdur</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">Alıcı mağaza səhifəsindən yazdıqda mesaj burada görünəcək.</p>
      </section>
      : <ul className="space-y-3">
        {inquiries.map((inquiry) => {
          const phone = normalizeAzPhone(inquiry.contactPhone);
          // Seller → buyer: open the chat without the buyer-side greeting.
          const whatsapp = phone?.mobile ? `https://wa.me/${phone.digits}` : null;
          const isNew = inquiry.status === "NEW";
          return <li key={inquiry.id} className={`rounded-card border bg-white p-5 ${isNew ? "border-gold-400" : "border-line"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-semibold text-[#142d38]">
                  {inquiry.name}
                  {isNew && <Badge tone="gold">Yeni</Badge>}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{dateFormat.format(inquiry.createdAt)}</p>
              </div>
              {isNew && <VendorInquiryReadButton storeId={storeId} inquiryId={inquiry.id} label="Oxunmuş et"/>}
            </div>
            <p className="mt-3 whitespace-pre-line break-words text-sm leading-6 text-[#344254]">{inquiry.message}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              {inquiry.contactEmail && <a href={`mailto:${inquiry.contactEmail}`} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#ded9cf] px-3 text-[#173c40]"><Mail size={15} aria-hidden="true"/>{inquiry.contactEmail}</a>}
              {phone && <a href={`tel:${phone.e164}`} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#ded9cf] px-3 text-[#173c40]"><Phone size={15} aria-hidden="true"/>{phone.display}</a>}
              {whatsapp && <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#1f7a4d] px-3 font-medium text-white"><MessageCircle size={15} aria-hidden="true"/>WhatsApp</a>}
            </div>
          </li>;
        })}
      </ul>}
  </div>;
}
