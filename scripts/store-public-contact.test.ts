import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatStoreAddress, openStreetMapUrl, safePublicMapUrl } from "../lib/store-public-contact";

// tsx compiles the components' JSX with the classic runtime, which needs a global React.
(globalThis as { React?: typeof React }).React = React;
const loadComponents = async () => ({
  StorefrontBranding: (await import("../components/storefront-branding")).default,
  StorefrontContact: (await import("../components/storefront-contact")).default,
});

test("address: city and region are not repeated", () => {
  assert.equal(formatStoreAddress("Qazax", "Qazax"), "Qazax");
  assert.equal(formatStoreAddress("qazax", "Qazax"), "qazax");
  assert.equal(formatStoreAddress("Nizami küç. 5, Bakı", "Bakı"), "Nizami küç. 5, Bakı");
  assert.equal(formatStoreAddress("Nizami küç. 5", "Bakı"), "Nizami küç. 5, Bakı");
  assert.equal(formatStoreAddress("Heydər Əliyev pr. 12, Qazax, Qazax", "Qazax"), "Heydər Əliyev pr. 12, Qazax");
  assert.equal(formatStoreAddress("  ,  ", "Gəncə"), "Gəncə");
  assert.equal(formatStoreAddress(null, null), null);
  assert.equal(formatStoreAddress("", ""), null);
});

test("map links: only http(s) without credentials; OpenStreetMap only for valid coordinates", () => {
  assert.equal(safePublicMapUrl("https://maps.google.com/?q=40.4,49.8"), "https://maps.google.com/?q=40.4,49.8");
  for (const unsafe of ["javascript:alert(1)", "data:text/html,x", "https://user:pass@maps.example", "maps.google.com", "", null]) {
    assert.equal(safePublicMapUrl(unsafe), null, String(unsafe));
  }
  assert.equal(openStreetMapUrl(41.09, 45.36), "https://www.openstreetmap.org/?mlat=41.09&mlon=45.36#map=16/41.09/45.36");
  assert.equal(openStreetMapUrl(null, 45), null);
  assert.equal(openStreetMapUrl(91, 45), null);
});

const SECRET_EMAIL = "store-owner-secret@example.az";

test("rendered header and contact card never contain the store email or a mailto link", async () => {
  const { StorefrontBranding, StorefrontContact } = await loadComponents();
  // Even if a caller passed extra fields, the components have no email prop to render.
  const header = renderToStaticMarkup(createElement(StorefrontBranding, { store: {
    id: "s1", name: "Qazax Ev Dünyası", logoUrl: null, bannerUrl: null, theme: "forest", cityName: "Qazax",
    whatsappUrl: "https://wa.me/994557614332?text=x", hasAbout: true, productCount: 0,
    ...{ contactEmail: SECRET_EMAIL },
  } as never }));
  const contact = renderToStaticMarkup(createElement(StorefrontContact, { info: {
    storeId: "s1", storeName: "Qazax Ev Dünyası", description: "Ev əşyaları", whatsappUrl: "https://wa.me/994557614332?text=x",
    phoneDisplay: "+994 55 761 43 32", telHref: "tel:+994557614332", address: "Qazax", mapLink: "https://maps.google.com/?q=1",
    coordinates: null, ...{ contactEmail: SECRET_EMAIL },
  } as never }));
  for (const html of [header, contact]) {
    assert.equal(html.includes(SECRET_EMAIL), false);
    assert.doesNotMatch(html, /mailto:/i);
  }
  assert.match(header, /target="_blank" rel="noopener noreferrer"[^>]*>[\s\S]*?WhatsApp/);
  assert.match(header, /href="#store-message"/);
  assert.match(contact, /href="tel:\+994557614332"/);
  assert.match(contact, /\+994 55 761 43 32/);
  assert.match(contact, /name="website"/);
  assert.match(contact, /name="consent"/);
});

test("store lookup combines id/slug and eligibility with AND, so eligibility cannot overwrite the match", async () => {
  const { publicStoreByIdOrSlugWhere } = await import("../lib/store-visibility");
  const where = publicStoreByIdOrSlugWhere("store-1", new Date("2026-11-12T12:00:00Z")) as { AND: Array<Record<string, unknown>>; OR?: unknown };
  assert.equal(where.OR, undefined);
  assert.deepEqual(where.AND[0], { OR: [{ id: "store-1" }, { slug: "store-1" }] });
  assert.ok(Array.isArray(where.AND[1].OR), "eligibility keeps its own OR inside the second AND branch");
  const page = readFileSync("app/(customer)/stores/[storeId]/page.tsx", "utf8");
  assert.match(page, /where: publicStoreByIdOrSlugWhere\(storeId\)/);
  assert.doesNotMatch(page, /OR: \[\{ id: storeId \}, \{ slug: storeId \}\],\s*\.\.\./);
});

test("public store page never selects or passes the store email", () => {
  const page = readFileSync("app/(customer)/stores/[storeId]/page.tsx", "utf8");
  assert.doesNotMatch(page.replace(/\/\/.*$/gm, ""), /contactEmail|mailto:/);
  for (const component of ["components/storefront-branding.tsx", "components/storefront-contact.tsx", "components/store-inquiry-form.tsx"]) {
    const source = readFileSync(component, "utf8");
    assert.doesNotMatch(source, /contactEmail\s*[:?]|mailto:/, component);
  }
});

test("WhatsApp button is hidden when the number cannot be normalized", async () => {
  const { StorefrontBranding } = await loadComponents();
  const html = renderToStaticMarkup(createElement(StorefrontBranding, { store: {
    id: "s1", name: "Mağaza", logoUrl: null, bannerUrl: null, theme: "forest", cityName: "Bakı", whatsappUrl: null, hasAbout: false, productCount: 3,
  } }));
  assert.doesNotMatch(html, /wa\.me|>WhatsApp</);
  assert.match(html, /Mesaj yaz/);
});
