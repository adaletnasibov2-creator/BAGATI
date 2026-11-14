/**
 * Phase C1: footer and contact page read the contact/footer settings with fallbacks to today's site.
 * Pure helpers + rendering of the footer (no database).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_FOOTER_LINKS, footerBottomLinks, toPublicContact, whatsappNumber } from "../lib/public-contact";
import { FOOTER_TAGLINE_DEFAULT } from "../lib/settings/registry";
import { CustomerFooter } from "../components/customer-footer";

// tsx compiles the components' JSX with the classic runtime, which needs a global React (as in store-public-contact.test.ts).
(globalThis as { React?: typeof React }).React = React;

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
const siteSettings = { siteName: "BAGATI", logoUrl: null, contactPhone: "+994501112233", contactEmail: "info@bagati.example", instagramUrl: null, facebookUrl: null, tiktokUrl: null };
const empty = toPublicContact({ tagline: null, address: null, workingHours: null, whatsapp: null, footerLinks: null });

test("fallbacks: default tagline, no address/hours, contact phone used for WhatsApp, today's three bottom links", () => {
  assert.equal(empty.tagline, FOOTER_TAGLINE_DEFAULT);
  assert.equal(empty.address, null);
  assert.deepEqual(whatsappNumber(empty, "+994501112233"), { number: "+994501112233", display: "+994501112233" });
  assert.deepEqual(footerBottomLinks(null).map((link) => link.href), ["/privacy", "/terms", "/support"]);
  assert.deepEqual(footerBottomLinks([]), DEFAULT_FOOTER_LINKS);
});

test("a dedicated WhatsApp number is normalised and wins over the contact phone", () => {
  const contact = toPublicContact({ tagline: "Şüar", address: "Bakı", workingHours: "09:00–21:00", whatsapp: "055 123 45 67", footerLinks: [{ label: "Qaydalar", href: "/terms" }] });
  assert.equal(contact.whatsapp, "+994551234567");
  assert.equal(contact.whatsappDisplay, "+994 55 123 45 67");
  assert.deepEqual(whatsappNumber(contact, "+994501112233"), { number: "+994551234567", display: "+994 55 123 45 67" });
  assert.deepEqual(footerBottomLinks(contact.footerLinks), [{ label: "Qaydalar", href: "/terms" }]);
});

test("footer without settings renders exactly today's text and links", () => {
  const before = renderToStaticMarkup(createElement(CustomerFooter, { settings: siteSettings }));
  const withDefaults = renderToStaticMarkup(createElement(CustomerFooter, { settings: siteSettings, contact: empty }));
  assert.equal(withDefaults, before, "default settings change nothing");
  assert.match(before, /Azərbaycan mağazalarını və məhsullarını bir məkanda kəşf et\./);
  assert.match(before, /WhatsApp · \+994501112233/);
  for (const href of ["/privacy", "/terms", "/support"]) assert.match(before, new RegExp(`href="${href}"`));
});

test("footer with settings: tagline, address, hours, WhatsApp number and admin links (escaped)", () => {
  const html = renderToStaticMarkup(createElement(CustomerFooter, { settings: siteSettings, contact: toPublicContact({
    tagline: "Yeni şüar <b>", address: "Bakı, Nizami küç. 1", workingHours: "Hər gün 09:00–21:00", whatsapp: "+994 55 123 45 67",
    footerLinks: [{ label: "Kampaniyalar", href: "/deals" }, { label: "Instagram", href: "https://instagram.com/bagati" }],
  }) }));
  assert.match(html, /Yeni şüar &lt;b&gt;/, "text is escaped by React");
  assert.match(html, /Bakı, Nizami küç\. 1/);
  assert.match(html, /İş saatları: <\/span>Hər gün 09:00–21:00/);
  assert.match(html, /WhatsApp · \+994 55 123 45 67/);
  assert.match(html, /href="https:\/\/wa\.me\/994551234567/);
  assert.match(html, /<nav aria-label="Footer keçidləri"[^>]*><a [^>]*href="\/deals"[^>]*>Kampaniyalar<\/a><a [^>]*href="https:\/\/instagram\.com\/bagati"/);
  assert.doesNotMatch(html, /href="\/support"[^>]*>Dəstək<\/a><\/nav>/, "admin links replace the default bottom links");
  assert.match(html, /Zəng et · \+994501112233/, "the contact phone stays reachable as a call link");
});

test("wiring: the customer layout and contact page read the settings", () => {
  assert.match(read("app/(customer)/layout.tsx"), /<CustomerFooter settings=\{settings\} contact=\{contact\} \/>/);
  const contact = read("app/(customer)/contact/page.tsx");
  assert.match(contact, /getPublicContact\(\)/);
  assert.match(contact, /contact\.address&&/);
  assert.match(contact, /contact\.workingHours&&/);
});
