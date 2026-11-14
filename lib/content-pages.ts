/**
 * Content pages (terms, privacy, about, help): built-in texts, the public reader and the input rules.
 *
 * The built-in texts are today's hard-coded page texts in the safe format (lib/content-markup.tsx). They are used
 * (1) whenever a page has no published row, so the site never shows an empty page, and (2) by the idempotent seed
 * (scripts/seed-content-pages.ts and release-output/prod-content-pages-seed.sql).
 */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { CONTENT_BODY_MAX } from "@/lib/content-markup";
import { logSecurityOperationFailure } from "@/lib/security-logging";

export const CONTENT_PAGE_SLUGS = ["terms", "privacy", "about", "help"] as const;
export type ContentPageSlug = (typeof CONTENT_PAGE_SLUGS)[number];
export const CONTENT_REVISIONS_KEPT = 20;

export function isContentPageSlug(value: unknown): value is ContentPageSlug {
  return typeof value === "string" && (CONTENT_PAGE_SLUGS as readonly string[]).includes(value);
}

export const CONTENT_PAGE_META: Record<ContentPageSlug, { path: string; adminLabel: string; showUpdatedAt: boolean }> = {
  terms: { path: "/terms", adminLabel: "İstifadə şərtləri", showUpdatedAt: true },
  privacy: { path: "/privacy", adminLabel: "Gizlilik siyasəti", showUpdatedAt: true },
  about: { path: "/about", adminLabel: "Haqqımızda", showUpdatedAt: false },
  help: { path: "/help", adminLabel: "Kömək mərkəzi", showUpdatedAt: false },
};

/** Today's texts (before Phase C1), converted to the safe format; wording unchanged. */
export const CONTENT_PAGE_DEFAULTS: Record<ContentPageSlug, { title: string; body: string }> = {
  terms: {
    title: "İstifadə şərtləri",
    body: [
      "**Hüquqi yoxlama üçün ilkin layihə — yekun təsdiq tələb olunur.**",
      "Bu səhifənin yekun mətni BAGATI platformasının müştəri və satıcı qaydaları, sifarişlər, ödənişlər, çatdırılma, qaytarılma və mübahisələrin həlli üzrə təsdiqlənmiş şərtlərə əsasən hazırlanmalıdır. Hazırda burada təsdiqlənmiş istifadə şərtləri dərc olunmayıb.",
      "Mövcud çatdırılma və qaytarılma məlumatlarına [buradan](/delivery-returns) baxın və suallar üçün [dəstəyə müraciət edin](/support).",
    ].join("\n\n"),
  },
  privacy: {
    title: "Gizlilik siyasəti",
    body: [
      "**Hüquqi yoxlama üçün ilkin layihə — yekun təsdiq tələb olunur.**",
      "Bu səhifənin yekun mətni BAGATI-nin məlumatların toplanması, istifadəsi, saxlanması və qorunması qaydaları təsdiqləndikdən sonra əlavə edilməlidir. Hazırda burada təsdiqlənmiş gizlilik siyasəti dərc olunmayıb.",
      "Məlumat və dəstək üçün [dəstək bölməsinə](/support) keçin.",
    ].join("\n\n"),
  },
  about: {
    title: "Yerli mağazalar üçün bir marketplace",
    body: [
      "BAGATI müştərilərə platformada qeydiyyatdan keçmiş aktiv mağazaların məhsullarına baxmaq, seçimləri müqayisə etmək və sifarişlərini idarə etmək üçün vahid rəqəmsal məkan təqdim edir.",
      "[Mağazalara bax](/stores) · [Əlaqə](/contact)",
    ].join("\n\n"),
  },
  help: {
    title: "Kömək mərkəzi",
    body: [
      "BAGATI alış-verişi ilə bağlı əsas məlumatlar.",
      "### Səbətimdə müxtəlif mağazalardan məhsul ola bilərmi?\nBəli. Səbət mağazalara görə qruplaşdırılır, sifariş isə mağaza sifarişlərinə bölünür.",
      "### Məhsul stokda yoxdursa nə baş verir?\nStok mövcudluğu məhsul səhifəsində göstərilir. Səbət və sifariş zamanı stok yenidən yoxlanılır.",
      "### Onlayn ödəniş edə bilərəmmi?\nÖdəniş provayderi hələ qoşulmayıb. Sifariş qeydi yaradıla bilər, lakin bu sayt onlayn ödəniş tutmur.",
      "### Şəhərimi necə dəyişə bilərəm?\nSəhifənin yuxarı hissəsindəki şəhər seçicisindən aktiv şəhəri seçin. Məhsul və mağaza siyahıları həmin şəhərə görə süzülür.",
      "Sualınız cavabsız qaldı? [Dəstək müraciəti göndərin.](/support)",
    ].join("\n\n"),
  },
};

export type PublicContentPage = { slug: ContentPageSlug; title: string; body: string; updatedAt: Date | null; fromDatabase: boolean };

/** The page to show: the published row, or the built-in text (also when the database cannot be read). */
export async function getPublicContentPage(slug: ContentPageSlug): Promise<PublicContentPage> {
  try {
    const row = await prisma.contentPage.findUnique({ where: { slug }, select: { title: true, body: true, published: true, updatedAt: true } });
    if (row?.published && row.body.trim()) return { slug, title: row.title, body: row.body, updatedAt: row.updatedAt, fromDatabase: true };
  } catch (error) {
    logSecurityOperationFailure("content_page_read", error);
  }
  return { slug, ...CONTENT_PAGE_DEFAULTS[slug], updatedAt: null, fromDatabase: false };
}

/** "14.11.2026" in Baku time (pages show only the date). */
export function formatContentDate(date: Date): string {
  return new Intl.DateTimeFormat("az-AZ", { timeZone: "Asia/Baku", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

const oneLine = (max: number) => z.string().transform((value) => value.replace(/\s+/g, " ").trim()).pipe(z.string().min(1, "Boş ola bilməz.").max(max, `Ən çox ${max} simvol.`));

export const contentPageSaveSchema = z.object({
  title: oneLine(160),
  body: z.string().transform((value) => value.replace(/\r\n?/g, "\n").trim()).pipe(z.string().min(1, "Mətn boş ola bilməz.").max(CONTENT_BODY_MAX, `Mətn ən çox ${CONTENT_BODY_MAX} simvol ola bilər.`)),
  note: z.string().max(400).optional().transform((value) => value?.replace(/\s+/g, " ").trim().slice(0, 200) || null),
  /** updatedAt (ISO) the editor was opened with; null = the page has no row yet. Stale saves are refused. */
  expectedUpdatedAt: z.string().datetime().nullable(),
}).strict();

export const contentPageRestoreSchema = z.object({
  revisionId: z.string().min(1).max(64),
  expectedUpdatedAt: z.string().datetime().nullable(),
}).strict();
