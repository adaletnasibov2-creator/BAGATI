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
  /** Logged-in customer with messaging ON: a "Mağazaya yaz" conversation instead of the anonymous form. */
  messageHref?: string | null;
};

const rowLink = "inline-flex min-h-11 items-center gap-1 font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return <li className="flex gap-3 py-3">
    <span aria-hidden="true" className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-subtle text-primary ring-1 ring-inset ring-brand-100">{icon}</span>
    <div className="min-w-0 flex-1">
      <p className="text-xs font-semibold uppercase tracking-[.12em] text-gold-700">{label}</p>
      <div className="mt-0.5 break-words text-sm text-fg">{children}</div>
    </div>
  </li>;
}

export default function StorefrontContact({ info }: { info: StorefrontContactInfo }) {
  return <div className="mt-10 grid gap-5 lg:grid-cols-[1.15fr_1fr]">
    <div className="grid gap-5">
      {info.description && <section id="store-about" className="scroll-mt-6 rounded-card border border-line bg-white p-5 sm:p-7">
        <p className="text-kicker uppercase text-gold-700">Mağaza haqqında</p>
        <h2 className="mt-1 font-display text-h3 text-fg">{info.storeName}</h2>
        <p className="mt-3 whitespace-pre-line text-sm leading-7 text-fg-body">{info.description}</p>
      </section>}
      <section id="store-message" className="scroll-mt-6 rounded-card border border-line bg-white p-5 sm:p-7">
        <p className="text-kicker uppercase text-gold-700">{info.messageHref ? "Mağazaya yaz" : "Mesaj yaz"}</p>
        <h2 className="mt-1 font-display text-h3 text-fg">Satıcıya sual verin</h2>
        {info.messageHref
          ? <>
            <p className="mt-1 text-sm leading-6 text-fg-secondary">Sualınızı yazın; mağazanın cavabı hesabınızdakı “Mesajlarım” bölməsinə gələcək.</p>
            <a href={info.messageHref} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"><MessageCircle size={16} aria-hidden="true"/>Mağazaya yaz</a>
          </>
          : <>
            <p className="mt-1 text-sm leading-6 text-fg-secondary">Mesajınız birbaşa mağazaya çatır. Satıcı qeyd etdiyiniz e-poçt və ya telefonla sizə cavab verəcək.</p>
            <div className="mt-5"><StoreInquiryForm storeId={info.storeId} storeName={info.storeName}/></div>
          </>}
      </section>
    </div>

    <section id="store-contact" aria-labelledby="store-contact-title" className="h-fit scroll-mt-6 rounded-card border border-line bg-white p-5 sm:p-7 lg:sticky lg:top-24">
      <p className="text-kicker uppercase text-gold-700">Əlaqə</p>
      <h2 id="store-contact-title" className="mt-1 font-display text-h3 text-fg">Mağaza ilə əlaqə</h2>
      <ul className="mt-3 divide-y divide-line">
        {info.whatsappUrl && <Row icon={<MessageCircle size={17}/>} label="WhatsApp">
          <a href={info.whatsappUrl} target="_blank" rel="noopener noreferrer" className={rowLink}>WhatsApp ilə yaz{info.phoneDisplay ? ` · ${info.phoneDisplay}` : ""}</a>
        </Row>}
        {info.telHref && info.phoneDisplay && <Row icon={<Phone size={17}/>} label="Telefon">
          <a href={info.telHref} className="inline-flex min-h-11 items-center rounded-sm text-fg hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">{info.phoneDisplay}</a>
        </Row>}
        <Row icon={<Mail size={17}/>} label="Mesaj">
          <a href={info.messageHref ?? "#store-message"} className={rowLink}>{info.messageHref ? "Mağazaya yaz" : "Mesaj formasını aç"}</a>
        </Row>
        {info.address && <Row icon={<MapPin size={17}/>} label="Ünvan">
          <p className="py-2">{info.address}</p>
          {info.mapLink && <a href={info.mapLink} target="_blank" rel="noopener noreferrer" className={rowLink}>Xəritədə aç <ExternalLink size={14} aria-hidden="true"/></a>}
        </Row>}
        {!info.address && info.mapLink && <Row icon={<MapPin size={17}/>} label="Yerləşmə">
          <a href={info.mapLink} target="_blank" rel="noopener noreferrer" className={rowLink}>Xəritədə aç <ExternalLink size={14} aria-hidden="true"/></a>
        </Row>}
      </ul>
      {info.coordinates && <InteractiveMap selected={info.coordinates} className="mt-4 h-52 overflow-hidden rounded-control" zoom={14}/>}
    </section>
  </div>;
}
