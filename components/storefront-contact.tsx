import { ExternalLink, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { InteractiveMap } from "@/components/interactive-map";
import StoreInquiryForm from "@/components/store-inquiry-form";

/**
 * About + structured contact card + message form for the public store page.
 * No email address is accepted or rendered here.
 */
export type StorefrontContactInfo = {
  storeId: string;
  storeName: string;
  description: string | null;
  whatsappUrl: string | null;
  phoneDisplay: string | null;
  telHref: string | null;
  address: string | null;
  mapLink: string | null;
  coordinates: { latitude: number; longitude: number } | null;
};

const rowLink = "inline-flex min-h-11 items-center gap-1 font-medium text-emerald hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52]";

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return <li className="flex gap-3 py-3">
    <span aria-hidden="true" className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#F0F4F0] text-[#2F5D50]">{icon}</span>
    <div className="min-w-0 flex-1">
      <p className="text-xs font-semibold uppercase tracking-[.12em] text-[#967844]">{label}</p>
      <div className="mt-0.5 break-words text-sm text-ink">{children}</div>
    </div>
  </li>;
}

export default function StorefrontContact({ info }: { info: StorefrontContactInfo }) {
  return <div className="mt-10 grid gap-5 lg:grid-cols-[1.15fr_1fr]">
    <div className="grid gap-5">
      {info.description && <section id="store-about" className="scroll-mt-6 rounded-2xl border border-line bg-white p-5 sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#967844]">Mağaza haqqında</p>
        <h2 className="mt-1 text-xl font-semibold text-ink">{info.storeName}</h2>
        <p className="mt-3 whitespace-pre-line text-sm leading-7 text-muted">{info.description}</p>
      </section>}
      <section id="store-message" className="scroll-mt-6 rounded-2xl border border-line bg-white p-5 sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#967844]">Mesaj yaz</p>
        <h2 className="mt-1 text-xl font-semibold text-ink">Satıcıya sual verin</h2>
        <p className="mt-1 text-sm leading-6 text-muted">Mesajınız birbaşa mağazaya çatır. Satıcı qeyd etdiyiniz e-poçt və ya telefonla sizə cavab verəcək.</p>
        <div className="mt-5"><StoreInquiryForm storeId={info.storeId} storeName={info.storeName}/></div>
      </section>
    </div>

    <section id="store-contact" aria-labelledby="store-contact-title" className="h-fit scroll-mt-6 rounded-2xl border border-line bg-white p-5 sm:p-7 lg:sticky lg:top-24">
      <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#967844]">Əlaqə</p>
      <h2 id="store-contact-title" className="mt-1 text-xl font-semibold text-ink">Mağaza ilə əlaqə</h2>
      <ul className="mt-3 divide-y divide-line">
        {info.whatsappUrl && <Row icon={<MessageCircle size={17}/>} label="WhatsApp">
          <a href={info.whatsappUrl} target="_blank" rel="noopener noreferrer" className={rowLink}>WhatsApp-da yaz{info.phoneDisplay ? ` · ${info.phoneDisplay}` : ""}</a>
        </Row>}
        {info.telHref && info.phoneDisplay && <Row icon={<Phone size={17}/>} label="Telefon">
          <a href={info.telHref} className="inline-flex min-h-11 items-center text-ink hover:underline">{info.phoneDisplay}</a>
        </Row>}
        <Row icon={<Mail size={17}/>} label="Mesaj">
          <a href="#store-message" className={rowLink}>Mesaj formasını aç</a>
        </Row>
        {info.address && <Row icon={<MapPin size={17}/>} label="Ünvan">
          <p className="py-2">{info.address}</p>
          {info.mapLink && <a href={info.mapLink} target="_blank" rel="noopener noreferrer" className={rowLink}>Xəritədə aç <ExternalLink size={14} aria-hidden="true"/></a>}
        </Row>}
        {!info.address && info.mapLink && <Row icon={<MapPin size={17}/>} label="Yerləşmə">
          <a href={info.mapLink} target="_blank" rel="noopener noreferrer" className={rowLink}>Xəritədə aç <ExternalLink size={14} aria-hidden="true"/></a>
        </Row>}
      </ul>
      {info.coordinates && <InteractiveMap selected={info.coordinates} className="mt-4 h-52 overflow-hidden rounded-xl" zoom={14}/>}
    </section>
  </div>;
}
