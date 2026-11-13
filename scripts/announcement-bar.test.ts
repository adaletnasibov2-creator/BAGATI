import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ANNOUNCEMENT_TONE_CLASSES } from "../components/announcement-tones";
import { ANNOUNCEMENT_DISMISS_KEY, announcementPrePaintScript, announcementSignature, isAnnouncementVisible, type AnnouncementView } from "../lib/announcement";
import { getSettingDefinition, SETTING_KEYS } from "../lib/settings/registry";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const now = new Date("2026-12-05T10:00:00.000Z");
const bar = (patch: Partial<AnnouncementView> = {}): AnnouncementView => ({ enabled: true, text: "Bayram endirimləri", href: null, tone: "info", startsAt: null, endsAt: null, ...patch });

test("visibility: enabled, text present, inside the optional dates (boundaries inclusive, like isHomeBannerVisible)", () => {
  assert.equal(isAnnouncementVisible(bar(), now), true);
  assert.equal(isAnnouncementVisible(bar({ enabled: false }), now), false);
  assert.equal(isAnnouncementVisible(bar({ text: "  " }), now), false);
  assert.equal(isAnnouncementVisible(null, now), false);
  assert.equal(isAnnouncementVisible(bar({ startsAt: "2026-12-06T00:00:00.000Z" }), now), false, "not started");
  assert.equal(isAnnouncementVisible(bar({ endsAt: "2026-12-05T09:59:59.000Z" }), now), false, "ended");
  assert.equal(isAnnouncementVisible(bar({ startsAt: now.toISOString(), endsAt: now.toISOString() }), now), true, "inclusive");
  assert.equal(isAnnouncementVisible(getSettingDefinition(SETTING_KEYS.announcementBar)!.default as AnnouncementView, now), false, "default: off");
});

test("dismissal signature: stable, hex, changes when the text, link or tone changes", () => {
  const signature = announcementSignature(bar());
  assert.match(signature, /^[0-9a-f]{8}$/);
  assert.equal(announcementSignature(bar()), signature);
  assert.notEqual(announcementSignature(bar({ text: "Yeni elan" })), signature);
  assert.notEqual(announcementSignature(bar({ href: "/products" })), signature);
  assert.notEqual(announcementSignature(bar({ tone: "danger" })), signature);
  assert.equal(announcementSignature(bar({ startsAt: "2026-12-01T00:00:00.000Z" })), signature, "dates do not reset a dismissal");
});

test("pre-paint script hides only a bar dismissed in this session, and never throws", () => {
  const signature = announcementSignature(bar());
  const script = announcementPrePaintScript(signature);
  assert.throws(() => announcementPrePaintScript("x\"</script>"), /invalid announcement signature/);
  assert.doesNotMatch(script, /<\/script/i);
  const run = (stored: string | null, storageThrows = false) => {
    const appended: { textContent: string }[] = [];
    const sessionStorage = { getItem: (key: string) => { if (storageThrows) throw new Error("blocked"); return key === ANNOUNCEMENT_DISMISS_KEY ? stored : null; } };
    const document = { createElement: () => ({ textContent: "" }), head: { appendChild: (node: { textContent: string }) => appended.push(node) } };
    new Function("sessionStorage", "document", script)(sessionStorage, document);
    return appended.map((node) => node.textContent);
  };
  assert.deepEqual(run(signature), [`[data-announcement-bar="${signature}"]{display:none}`]);
  assert.deepEqual(run(announcementSignature(bar({ text: "Köhnə elan" }))), [], "a different (older) text stays visible");
  assert.deepEqual(run(null), []);
  assert.deepEqual(run(signature, true), [], "storage errors are swallowed");
});

test("rendering: customer layout only, above the header, plain text, accessible, session dismissal in try/catch", () => {
  const layout = read("app/(customer)/layout.tsx");
  assert.ok(layout.indexOf("<AnnouncementBar />") > 0 && layout.indexOf("<AnnouncementBar />") < layout.indexOf("<Header"), "above the header");
  for (const panel of ["app/vendor/page.tsx", "app/vendor/[storeId]/layout.tsx", "components/admin-shell.tsx", "app/layout.tsx"]) assert.doesNotMatch(read(panel), /AnnouncementBar/, panel);
  const server = read("components/announcement-bar.tsx");
  assert.doesNotMatch(server, /^\s*["']use client["']/);
  assert.match(server, /getSetting<AnnouncementView>\(SETTING_KEYS\.announcementBar\)/);
  assert.match(server, /if \(!bar \|\| !isAnnouncementVisible\(bar\)\) return null;/);
  assert.match(server, /<section role="region" aria-label="Elan" data-announcement-bar=\{signature\}>/);
  assert.match(server, /dangerouslySetInnerHTML=\{\{ __html: announcementPrePaintScript\(signature\) \}\}/);
  const client = read("components/announcement-bar-client.tsx");
  assert.match(client, /^"use client";/);
  assert.doesNotMatch(client, /@\/lib\/settings\//);
  assert.doesNotMatch(client, /dangerouslySetInnerHTML/, "text is plain text");
  assert.match(client, /\{bar\.text\}/);
  assert.match(client, /try \{ sessionStorage\.setItem\(ANNOUNCEMENT_DISMISS_KEY, signature\); \} catch/);
  assert.match(client, /aria-label="Elanı bağla"/);
  assert.deepEqual(Object.keys(ANNOUNCEMENT_TONE_CLASSES).sort(), ["danger", "info", "success", "warning"]);
});

test("tone classes live where Tailwind scans them (the browser check found an invisible white-on-white bar)", () => {
  const config = read("tailwind.config.ts");
  const globs = [...config.matchAll(/"\.\/([a-z]+)\/\*\*\/\*\.\{ts,tsx\}"/g)].map((match) => match[1]);
  assert.ok(globs.includes("components"), "components/ is scanned");
  assert.ok(!globs.includes("lib"), "lib/ is not scanned, so no Tailwind class may be defined only in lib/");
  assert.doesNotMatch(read("lib/announcement.ts"), /\bbg-|text-white/, "no tone classes in lib/");
  assert.match(read("components/announcement-tones.ts"), /success: "bg-green-700 text-white"/);
});
