/**
 * Contact and footer values for public pages (footer, contact page), from the settings engine (30 s cache,
 * fail-safe) with fallbacks to today's site. The pure helpers are unit-tested.
 */
import { getSetting } from "@/lib/settings/read";
import { FOOTER_TAGLINE_DEFAULT, SETTING_KEYS, type FooterLink } from "@/lib/settings/registry";
import { normalizeAzPhone } from "@/lib/az-phone";

export type PublicContact = {
  tagline: string;
  address: string | null;
  workingHours: string | null;
  /** E.164 (+994…) of the dedicated WhatsApp number, or null. */
  whatsapp: string | null;
  /** Shown as typed (+994 55 123 45 67). */
  whatsappDisplay: string | null;
  footerLinks: FooterLink[] | null;
};

/** Bottom-bar footer links before Phase C1; used whenever footer.links is not set. */
export const DEFAULT_FOOTER_LINKS: readonly FooterLink[] = [
  { label: "Gizlilik", href: "/privacy" },
  { label: "İstifadə şərtləri", href: "/terms" },
  { label: "Dəstək", href: "/support" },
];

export function footerBottomLinks(links: FooterLink[] | null): readonly FooterLink[] {
  return links && links.length ? links : DEFAULT_FOOTER_LINKS;
}

/** WhatsApp number to use: the dedicated setting when valid, otherwise the site contact phone (today's behaviour). */
export function whatsappNumber(contact: Pick<PublicContact, "whatsapp" | "whatsappDisplay">, contactPhone: string | null): { number: string | null; display: string | null } {
  if (contact.whatsapp) return { number: contact.whatsapp, display: contact.whatsappDisplay ?? contact.whatsapp };
  return { number: contactPhone, display: contactPhone };
}

export function toPublicContact(values: { tagline: string | null; address: string | null; workingHours: string | null; whatsapp: string | null; footerLinks: FooterLink[] | null }): PublicContact {
  const phone = normalizeAzPhone(values.whatsapp);
  return {
    tagline: values.tagline || FOOTER_TAGLINE_DEFAULT,
    address: values.address || null,
    workingHours: values.workingHours || null,
    whatsapp: phone?.e164 ?? null,
    whatsappDisplay: phone?.display ?? null,
    footerLinks: values.footerLinks && values.footerLinks.length ? values.footerLinks : null,
  };
}

export async function getPublicContact(): Promise<PublicContact> {
  const [tagline, address, workingHours, whatsapp, footerLinks] = await Promise.all([
    getSetting<string>(SETTING_KEYS.footerTagline),
    getSetting<string>(SETTING_KEYS.contactAddress),
    getSetting<string>(SETTING_KEYS.contactWorkingHours),
    getSetting<string>(SETTING_KEYS.contactWhatsapp),
    getSetting<FooterLink[]>(SETTING_KEYS.footerLinks),
  ]);
  return toPublicContact({ tagline, address, workingHours, whatsapp, footerLinks });
}
