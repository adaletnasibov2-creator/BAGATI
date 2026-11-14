/**
 * Settings engine registry: the only list of keys an admin can change. Server-only by convention
 * (scripts/settings-registry.test.ts fails if a "use client" file imports lib/settings).
 *
 * Every key declares its stored type (zod), the admin input (and its conversion), a safe default, bounds,
 * an Azerbaijani label and description, a group, a permission and whether a change is "sensitive".
 * The code default always applies when the key has no row, when the row is NULL, or when a stored value fails
 * validation, so the site works with an empty table. Every default equals the behaviour before the setting
 * existed (scripts/settings-registry.test.ts compares them with the code constants and texts).
 *
 * Never add secrets, keys, connection strings, base URLs, proxy trust, 2FA, session or CSRF policy, roles or
 * permissions here: they stay in environment variables or code. The registry test rejects such key names and
 * such field names inside object values.
 */
import { z } from "zod";
import { commissionPercentToRate, commissionRateToPercent } from "@/lib/commission-rules";
import { isSafeHomepageHref } from "@/lib/site-content";
import { ANNOUNCEMENT_TONE_LABELS } from "@/lib/announcement";
import { AZ_PHONE_ERROR, normalizeAzPhone } from "@/lib/az-phone";

export type SettingPermission = "settings.finance" | "settings.content" | "settings.limits";
export type SettingGroupId = "finance" | "seo" | "announcement" | "limits" | "contact" | "footer" | "maintenance";

export const SETTING_GROUPS: Record<SettingGroupId, { label: string; description: string }> = {
  finance: { label: "Maliyyə", description: "Komissiya və digər maliyyə parametrləri." },
  seo: { label: "SEO", description: "Axtarış sistemləri və sosial şəbəkələr üçün standart mətnlər." },
  announcement: { label: "Elan zolağı", description: "Bütün müştəri səhifələrinin yuxarısında göstərilən bir elan." },
  limits: { label: "Limitlər", description: "Mesaj və satıcı müraciəti limitləri. Hədlər kodda qorunur." },
  contact: { label: "Əlaqə", description: "Footer və əlaqə səhifəsində göstərilən ünvan, iş saatları və WhatsApp nömrəsi." },
  footer: { label: "Footer", description: "Footer şüarı və footer keçidləri. Boş qalanda indiki mətn və keçidlər göstərilir." },
  maintenance: { label: "Texniki iş rejimi", description: "Açıq olanda müştəri və satıcı səhifələri müvəqqəti bağlanır; admin paneli və ödəniş bildirişləri işləyir." },
};

export type SettingInput =
  | { kind: "percent"; min: number; max: number; step: number; unit: "%" }
  | { kind: "integer"; min: number; max: number; unit?: string }
  | { kind: "text"; minLength: number; maxLength: number; multiline?: boolean; placeholder?: string; mustContain?: string }
  | { kind: "announcement"; textMax: number }
  /** On/off switch (stored as a boolean). */
  | { kind: "toggle" }
  /** List of { label, href } rows (footer links). */
  | { kind: "links"; maxItems: number; labelMax: number };

export type SettingDefinition<T = unknown> = {
  key: string;
  group: SettingGroupId;
  permission: SettingPermission;
  /** Sensitive changes need confirm: true and a written reason (10–500 characters). */
  sensitive: boolean;
  /** Shown in the confirmation step of a sensitive change. */
  sensitiveNotice?: string;
  label: string;
  description: string;
  /** Validates the stored (canonical) value, on every write and every read. */
  schema: z.ZodType<T>;
  /** Converts the admin's input (as typed in the form) into the stored value. */
  inputSchema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** Formats a stored value for the form and the history ("10" for "0.1000"). */
  toInput: (value: T) => string;
  /** Form state for composite inputs (announcement); simple inputs use toInput. */
  toForm?: (value: T | null) => Record<string, string | boolean>;
  /** Field names of an object value, scanned by the forbidden-name test. */
  objectFields?: readonly string[];
  /** Formats a value for people ("10%"); null means the default "not set". */
  display: (value: T | null) => string;
  /** null = the setting has no value by default (behaviour unchanged). */
  default: T | null;
  input: SettingInput;
  /** "ttl" = served from the 30 second cache; "uncached" = must be read inside the transaction that uses it. */
  read: "ttl" | "uncached";
};

// ---- Commission (percent in the form, decimal string in storage) -------------------------------------------

/** Hard maximum of the default commission: 30%. Step 0.01% (Decimal(5,4) on StoreOrder.commissionRateSnapshot). */
export const COMMISSION_MAX_BASIS_POINTS = 3000;

/** "10" → "0.1000", "12.5" → "0.1250", "0.01" → "0.0001". Integer arithmetic only; never a float. */
export function percentToRate(percent: string): string | null {
  return commissionPercentToRate(percent, COMMISSION_MAX_BASIS_POINTS / 100);
}

/** "0.1000" → "10", "0.1250" → "12.5", "0.0001" → "0.01". */
export function rateToPercent(rate: string): string {
  return commissionRateToPercent(rate);
}

const commissionRate = z.string().regex(/^0\.\d{4}$/, "Komissiya 0.0000 formatında saxlanılmalıdır")
  .refine((value) => Number(value.slice(2)) <= COMMISSION_MAX_BASIS_POINTS, "Komissiya 30%-dən çox ola bilməz");

const commissionDefaultRate: SettingDefinition<string> = {
  key: "commission.defaultRate",
  group: "finance",
  permission: "settings.finance",
  sensitive: true,
  sensitiveNotice: "Yalnız bundan sonra yaradılan sifarişlərə tətbiq olunur; mövcud sifarişlər dəyişmir.",
  label: "Standart komissiya faizi",
  description: "Mağazanın öz komissiya qaydası yoxdursa, yeni sifarişlərə bu faiz tətbiq olunur. Mağazanın qaydası varsa, o üstündür. Boş olduqda komissiya qeydə alınmır (bugünkü vəziyyət).",
  schema: commissionRate,
  inputSchema: z.union([z.string(), z.number()]).transform((raw, context) => {
    const rate = percentToRate(String(raw));
    if (!rate) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Faizi 0 ilə 30 arasında, ən çox iki onluq rəqəmlə yazın (məsələn 10 və ya 12.5)." });
      return z.NEVER;
    }
    return rate;
  }),
  toInput: rateToPercent,
  display: (value) => (value === null ? "Təyin edilməyib" : `${rateToPercent(value)}%`),
  default: null,
  input: { kind: "percent", min: 0, max: 30, step: 0.01, unit: "%" },
  read: "uncached",
};

// ---- Builders for the simple kinds -------------------------------------------------------------------------

/** One-line text: whitespace (including line breaks) collapses to single spaces; trimmed; length-bounded. */
function textSetting(options: {
  key: string; group: SettingGroupId; permission: SettingPermission; label: string; description: string;
  minLength: number; maxLength: number; default: string | null; extra?: (value: string) => string | null; placeholder?: string; mustContain?: string;
}): SettingDefinition<string> {
  const lengthMessage = `${options.minLength}–${options.maxLength} simvol yazın.`;
  const check = (value: string, context: z.RefinementCtx) => {
    if (value.length < options.minLength || value.length > options.maxLength) context.addIssue({ code: z.ZodIssueCode.custom, message: lengthMessage });
    const extra = options.extra?.(value);
    if (extra) context.addIssue({ code: z.ZodIssueCode.custom, message: extra });
  };
  return {
    key: options.key,
    group: options.group,
    permission: options.permission,
    sensitive: false,
    label: options.label,
    description: options.description,
    schema: z.string().superRefine((value, context) => {
      if (value !== value.trim() || /[\r\n\t]/.test(value)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Bir sətirlik mətn olmalıdır." });
      check(value, context);
    }),
    inputSchema: z.string().transform((raw) => raw.replace(/\s+/g, " ").trim()).superRefine(check),
    toInput: (value) => value,
    display: (value) => (value === null ? "Təyin edilməyib" : value),
    default: options.default,
    input: { kind: "text", minLength: options.minLength, maxLength: options.maxLength, placeholder: options.placeholder, mustContain: options.mustContain, multiline: options.maxLength > 120 },
    read: "ttl",
  };
}

function integerSetting(options: {
  key: string; group: SettingGroupId; permission: SettingPermission; label: string; description: string;
  min: number; max: number; default: number; unit: string;
}): SettingDefinition<number> {
  const message = `${options.min} ilə ${options.max} arasında tam ədəd yazın.`;
  return {
    key: options.key,
    group: options.group,
    permission: options.permission,
    sensitive: false,
    label: options.label,
    description: options.description,
    schema: z.number().int().min(options.min).max(options.max),
    inputSchema: z.union([z.string(), z.number()]).transform((raw, context) => {
      const text = String(raw).trim();
      const value = /^\d{1,6}$/.test(text) ? Number(text) : Number.NaN;
      if (!Number.isInteger(value) || value < options.min || value > options.max) {
        context.addIssue({ code: z.ZodIssueCode.custom, message });
        return z.NEVER;
      }
      return value;
    }),
    toInput: (value) => String(value),
    display: (value) => (value === null ? "Təyin edilməyib" : `${value} ${options.unit}`),
    default: options.default,
    input: { kind: "integer", min: options.min, max: options.max, unit: options.unit },
    read: "ttl",
  };
}

// ---- SEO -----------------------------------------------------------------------------------------------------

/** Placeholder replaced by the store name in seo.storeDescriptionTemplate. */
export const STORE_NAME_PLACEHOLDER = "{store}";

const seoSettings = [
  textSetting({
    key: "seo.defaultDescription", group: "seo", permission: "settings.content",
    label: "Saytın standart təsviri (meta description)",
    description: "Axtarış nəticələrində saytın altında göstərilən qısa təsvir. Səhifənin öz təsviri yoxdursa, bu istifadə olunur.",
    minLength: 50, maxLength: 300,
    default: "Azərbaycan mağazalarını və məhsullarını bir marketplace-də kəşf edin.",
  }),
  textSetting({
    key: "seo.defaultOgTitle", group: "seo", permission: "settings.content",
    label: "Sosial şəbəkə başlığı (Open Graph)",
    description: "Link Facebook, WhatsApp və s. paylaşıldıqda görünən başlıq. Boş olduqda Open Graph başlığı göndərilmir (bugünkü vəziyyət).",
    minLength: 1, maxLength: 120, default: null,
  }),
  textSetting({
    key: "seo.defaultOgDescription", group: "seo", permission: "settings.content",
    label: "Sosial şəbəkə təsviri (Open Graph)",
    description: "Paylaşılan linkin altında görünən təsvir. Boş olduqda Open Graph təsviri göndərilmir (bugünkü vəziyyət).",
    minLength: 1, maxLength: 300, default: null,
  }),
  textSetting({
    key: "seo.storeDescriptionTemplate", group: "seo", permission: "settings.content",
    label: "Mağaza səhifəsi üçün standart təsvir",
    description: "Mağazanın öz təsviri yoxdursa istifadə olunur. {store} mağazanın adı ilə əvəz olunur. Meta təsvir 160 simvola qədər qısaldılır.",
    minLength: 20, maxLength: 300,
    default: "Məhsulları {store} mağazasından BAGATI marketplace-də kəşf edin.",
    extra: (value) => (value.split(STORE_NAME_PLACEHOLDER).length - 1 === 1 ? null : "Mətndə {store} yer tutucusu düz bir dəfə olmalıdır."),
    placeholder: "… {store} …",
    mustContain: STORE_NAME_PLACEHOLDER,
  }),
];

// ---- Limits --------------------------------------------------------------------------------------------------

const limitSettings = [
  integerSetting({
    key: "limits.inquiry.perIpPerHour", group: "limits", permission: "settings.limits",
    label: "Mağazaya mesaj: bir IP-dən saatda",
    description: "Bir alıcı IP ünvanından bir saatda göndərilə bilən mesaj sayı (yalnız etibarlı IP məlum olduqda tətbiq olunur).",
    min: 1, max: 50, default: 5, unit: "mesaj",
  }),
  integerSetting({
    key: "limits.inquiry.perStorePerHour", group: "limits", permission: "settings.limits",
    label: "Mağazaya mesaj: bir mağazaya saatda",
    description: "Bir mağazanın bir saatda qəbul edə biləcəyi mesaj sayı (bütün göndərənlər üzrə).",
    min: 5, max: 500, default: 30, unit: "mesaj",
  }),
  integerSetting({
    key: "limits.sellerApplication.reapplyWaitHours", group: "limits", permission: "settings.limits",
    label: "Satıcı müraciəti: təkrar müraciətə qədər gözləmə",
    description: "Rədd edilmiş və ya geri götürülmüş müraciətdən sonra yeni müraciətə qədər gözləmə müddəti.",
    min: 1, max: 168, default: 24, unit: "saat",
  }),
  integerSetting({
    key: "limits.sellerApplication.maxPer30Days", group: "limits", permission: "settings.limits",
    label: "Satıcı müraciəti: 30 gündə ən çox",
    description: "Bir müştərinin istənilən 30 gün ərzində göndərə biləcəyi müraciət sayı. 30 günlük müddət kodda sabitdir.",
    min: 1, max: 10, default: 3, unit: "müraciət",
  }),
  integerSetting({
    key: "limits.sellerApplication.perUserPerHour", group: "limits", permission: "settings.limits",
    label: "Satıcı müraciəti sorğuları: bir istifadəçidən saatda",
    description: "Müraciət səhifəsinin API sorğuları üçün istifadəçi başına saatlıq limit (göndərmə və geri götürmə).",
    min: 5, max: 100, default: 20, unit: "sorğu",
  }),
  integerSetting({
    key: "limits.sellerApplication.perIpPerHour", group: "limits", permission: "settings.limits",
    label: "Satıcı müraciəti sorğuları: bir IP-dən saatda",
    description: "Eyni IP ünvanından bütün istifadəçilər üzrə saatlıq limit (yalnız etibarlı IP məlum olduqda tətbiq olunur).",
    min: 10, max: 500, default: 60, unit: "sorğu",
  }),
];

// ---- Announcement bar ----------------------------------------------------------------------------------------

export const ANNOUNCEMENT_TONES = ["info", "success", "warning", "danger"] as const;
export type AnnouncementTone = (typeof ANNOUNCEMENT_TONES)[number];
export { ANNOUNCEMENT_TONE_LABELS };
export const ANNOUNCEMENT_TEXT_MAX = 200;

export type AnnouncementBar = {
  enabled: boolean;
  text: string;
  href: string | null;
  tone: AnnouncementTone;
  /** ISO instants (UTC). null = no limit on that side. */
  startsAt: string | null;
  endsAt: string | null;
};

const ANNOUNCEMENT_DEFAULT: AnnouncementBar = { enabled: false, text: "", href: null, tone: "info", startsAt: null, endsAt: null };
const BAKU_OFFSET = "+04:00";

/** "2026-12-01T09:30" (Baku, no DST) → ISO UTC instant; "" → null; anything else → undefined (invalid). */
export function bakuLocalToIso(value: string): string | null | undefined {
  if (!value.trim()) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value.trim())) return undefined;
  const date = new Date(`${value.trim()}:00${BAKU_OFFSET}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** ISO instant → "YYYY-MM-DDTHH:mm" in Baku time (for datetime-local inputs). */
export function isoToBakuLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(new Date(iso).getTime() + 4 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 16);
}

const announcementObject = z.object({
  enabled: z.boolean(),
  text: z.string().max(ANNOUNCEMENT_TEXT_MAX, `Mətn ən çox ${ANNOUNCEMENT_TEXT_MAX} simvol ola bilər.`)
    .refine((value) => !/[\r\n\t]/.test(value) && value === value.trim(), "Mətn bir sətir olmalıdır."),
  href: z.string().max(1000).refine(isSafeHomepageHref, "Keçid / ilə başlamalı və ya HTTPS ünvanı olmalıdır.").nullable(),
  tone: z.enum(ANNOUNCEMENT_TONES),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
}).strict().superRefine((value, context) => {
  if (value.enabled && !value.text) context.addIssue({ code: z.ZodIssueCode.custom, path: ["text"], message: "Aktiv elan üçün mətn yazın." });
  if (value.startsAt && value.endsAt && new Date(value.endsAt) <= new Date(value.startsAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "Bitmə vaxtı başlanğıcdan sonra olmalıdır." });
  }
});

const announcementBar: SettingDefinition<AnnouncementBar> = {
  key: "announcement.bar",
  group: "announcement",
  permission: "settings.content",
  sensitive: false,
  label: "Elan zolağı",
  description: "Bütün müştəri səhifələrinin yuxarısında bir sətirlik elan. Satıcı və admin panellərində göstərilmir. Ziyarətçi bağlaya bilər; mətn dəyişəndə yenidən görünür.",
  schema: announcementObject as z.ZodType<AnnouncementBar>,
  inputSchema: z.object({
    enabled: z.union([z.boolean(), z.enum(["true", "false"])]).transform((value) => value === true || value === "true"),
    text: z.string().max(1000).transform((value) => value.replace(/\s+/g, " ").trim()),
    href: z.string().max(1000).optional().transform((value) => value?.trim() || null),
    tone: z.enum(ANNOUNCEMENT_TONES),
    startsAt: z.string().max(40).optional(),
    endsAt: z.string().max(40).optional(),
  }).transform((raw, context) => {
    const startsAt = bakuLocalToIso(raw.startsAt ?? "");
    const endsAt = bakuLocalToIso(raw.endsAt ?? "");
    if (startsAt === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["startsAt"], message: "Başlanğıc vaxtını yoxlayın." });
    if (endsAt === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "Bitmə vaxtını yoxlayın." });
    const value = { enabled: raw.enabled, text: raw.text, href: raw.href, tone: raw.tone, startsAt: startsAt ?? null, endsAt: endsAt ?? null };
    const checked = announcementObject.safeParse(value);
    if (!checked.success) for (const issue of checked.error.issues) context.addIssue(issue);
    return value as AnnouncementBar;
  }),
  toInput: (value) => JSON.stringify(value),
  toForm: (value) => {
    const bar = value ?? ANNOUNCEMENT_DEFAULT;
    return { enabled: bar.enabled, text: bar.text, href: bar.href ?? "", tone: bar.tone, startsAt: isoToBakuLocal(bar.startsAt), endsAt: isoToBakuLocal(bar.endsAt) };
  },
  objectFields: ["enabled", "text", "href", "tone", "startsAt", "endsAt"],
  display: (value) => {
    const bar = value ?? ANNOUNCEMENT_DEFAULT;
    if (!bar.enabled) return "Söndürülüb";
    const text = bar.text.length > 60 ? `${bar.text.slice(0, 60)}…` : bar.text;
    return `Aktiv (${ANNOUNCEMENT_TONE_LABELS[bar.tone]}): ${text}`;
  },
  default: ANNOUNCEMENT_DEFAULT,
  input: { kind: "announcement", textMax: ANNOUNCEMENT_TEXT_MAX },
  read: "ttl",
};

// ---- Contact and footer (shown in the "Ümumi" tab) ---------------------------------------------------------

/** Footer tagline today (components/customer-footer.tsx); the default keeps it. */
export const FOOTER_TAGLINE_DEFAULT = "Azərbaycan mağazalarını və məhsullarını bir məkanda kəşf et.";
export const FOOTER_LINKS_MAX = 6;
export const FOOTER_LINK_LABEL_MAX = 40;

const contactSettings = [
  textSetting({
    key: "contact.address", group: "contact", permission: "settings.content",
    label: "Ünvan",
    description: "Footer və əlaqə səhifəsində göstərilən ünvan. Boş qalanda göstərilmir.",
    minLength: 3, maxLength: 200, default: null, placeholder: "Bakı şəhəri, Nizami küç. 1",
  }),
  textSetting({
    key: "contact.workingHours", group: "contact", permission: "settings.content",
    label: "İş saatları",
    description: "Footer və əlaqə səhifəsində göstərilən iş saatları. Boş qalanda göstərilmir.",
    minLength: 3, maxLength: 120, default: null, placeholder: "Hər gün 09:00–21:00",
  }),
  textSetting({
    key: "contact.whatsapp", group: "contact", permission: "settings.content",
    label: "WhatsApp nömrəsi",
    description: "Ayrıca WhatsApp nömrəsi. Boş qalanda əvvəlki kimi əlaqə telefonu WhatsApp üçün istifadə olunur.",
    minLength: 7, maxLength: 40, default: null, placeholder: "+994 55 123 45 67",
    extra: (value) => (normalizeAzPhone(value) ? null : AZ_PHONE_ERROR),
  }),
];

export type FooterLink = { label: string; href: string };

const footerLinkSchema = z.object({
  label: z.string().min(1).max(FOOTER_LINK_LABEL_MAX).refine((value) => value === value.trim() && !/[\r\n\t]/.test(value), "Bir sətirlik ad yazın."),
  href: z.string().min(1).max(500).refine(isSafeHomepageHref, "Keçid / ilə başlayan daxili yol və ya HTTPS ünvan olmalıdır."),
}).strict();

const footerLinks: SettingDefinition<FooterLink[]> = {
  key: "footer.links",
  group: "footer",
  permission: "settings.content",
  sensitive: false,
  label: "Footer keçidləri",
  description: `Footerdə göstərilən ən çox ${FOOTER_LINKS_MAX} keçid (ad və ünvan). Boş qalanda indiki keçidlər göstərilir.`,
  schema: z.array(footerLinkSchema).min(1).max(FOOTER_LINKS_MAX),
  // Form rows: label0/href0 … label5/href5; fully empty rows are ignored.
  inputSchema: z.record(z.union([z.string(), z.boolean()])).transform((raw, context) => {
    const rows: FooterLink[] = [];
    for (let index = 0; index < FOOTER_LINKS_MAX; index += 1) {
      const label = String(raw[`label${index}`] ?? "").replace(/\s+/g, " ").trim();
      const href = String(raw[`href${index}`] ?? "").trim();
      if (!label && !href) continue;
      if (!label || !href) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [`row${index}`], message: `${index + 1}-ci sətir: həm ad, həm keçid yazın.` });
        continue;
      }
      const checked = footerLinkSchema.safeParse({ label, href });
      if (!checked.success) {
        for (const issue of checked.error.issues) context.addIssue({ ...issue, path: [`row${index}`], message: `${index + 1}-ci sətir: ${issue.message}` });
        continue;
      }
      rows.push(checked.data);
    }
    if (!rows.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Ən azı bir keçid yazın və ya standart keçidlərə qaytarın." });
    return rows;
  }),
  toInput: (value) => JSON.stringify(value),
  toForm: (value) => {
    const form: Record<string, string> = {};
    for (let index = 0; index < FOOTER_LINKS_MAX; index += 1) {
      form[`label${index}`] = value?.[index]?.label ?? "";
      form[`href${index}`] = value?.[index]?.href ?? "";
    }
    return form;
  },
  objectFields: ["label", "href"],
  display: (value) => (value === null ? "Standart keçidlər" : value.map((link) => link.label).join(", ")),
  default: null,
  input: { kind: "links", maxItems: FOOTER_LINKS_MAX, labelMax: FOOTER_LINK_LABEL_MAX },
  read: "ttl",
};

const footerSettings = [
  textSetting({
    key: "footer.tagline", group: "footer", permission: "settings.content",
    label: "Footer şüarı",
    description: "Footerdə logonun altında göstərilən qısa mətn.",
    minLength: 3, maxLength: 160, default: FOOTER_TAGLINE_DEFAULT,
  }),
  footerLinks,
];

// ---- Maintenance mode ---------------------------------------------------------------------------------------

export const MAINTENANCE_MESSAGE_DEFAULT = "Saytda texniki işlər aparılır. Bir azdan yenidən yoxlayın.";

const maintenanceEnabled: SettingDefinition<boolean> = {
  key: "maintenance.enabled",
  group: "maintenance",
  permission: "settings.content",
  sensitive: true,
  sensitiveNotice: "Açıq olanda bütün müştəri və satıcı səhifələri və API-ləri 503 qaytarır: alış-veriş, səbət və sifariş dayanır. Admin paneli və ödəniş bildirişləri işləməyə davam edir.",
  label: "Texniki iş rejimi",
  description: "Saytı müvəqqəti bağlayır. Admin paneli, admin girişi, /api/ready və ödəniş bildirişləri açıq qalır.",
  schema: z.boolean(),
  inputSchema: z.union([z.boolean(), z.enum(["true", "false"])]).transform((value) => value === true || value === "true"),
  toInput: (value) => String(value),
  display: (value) => (value ? "Açıqdır — sayt bağlıdır" : "Söndürülüb"),
  default: false,
  input: { kind: "toggle" },
  read: "ttl",
};

const maintenanceSettings = [
  maintenanceEnabled,
  textSetting({
    key: "maintenance.message", group: "maintenance", permission: "settings.content",
    label: "Texniki iş mesajı",
    description: "Texniki iş rejimində müştərilərə göstərilən mətn.",
    minLength: 10, maxLength: 300, default: MAINTENANCE_MESSAGE_DEFAULT,
  }),
];

// ---- Registry ----------------------------------------------------------------------------------------------

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  commissionDefaultRate as SettingDefinition,
  ...(seoSettings as SettingDefinition[]),
  ...(limitSettings as SettingDefinition[]),
  announcementBar as SettingDefinition,
  ...(contactSettings as SettingDefinition[]),
  ...(footerSettings as SettingDefinition[]),
  ...(maintenanceSettings as SettingDefinition[]),
];

/**
 * Key names (or object field names, as "key#field") allowed despite matching the forbidden-name pattern, each with a
 * written justification. Empty today: no key or field name matches. The announcement link field is called "href"
 * (a public page link validated by isSafeHomepageHref), which the pattern does not flag; if it is ever renamed to
 * something ending in "Url", add "announcement.bar#<name>" here with that justification.
 */
export const FORBIDDEN_NAME_EXCEPTIONS: Readonly<Record<string, string>> = {};

const byKey = new Map(SETTING_DEFINITIONS.map((definition) => [definition.key, definition]));

export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return byKey.get(key);
}

export const SETTING_KEYS = {
  commissionDefaultRate: "commission.defaultRate",
  seoDefaultDescription: "seo.defaultDescription",
  seoDefaultOgTitle: "seo.defaultOgTitle",
  seoDefaultOgDescription: "seo.defaultOgDescription",
  seoStoreDescriptionTemplate: "seo.storeDescriptionTemplate",
  inquiryPerIpPerHour: "limits.inquiry.perIpPerHour",
  inquiryPerStorePerHour: "limits.inquiry.perStorePerHour",
  sellerApplicationReapplyWaitHours: "limits.sellerApplication.reapplyWaitHours",
  sellerApplicationMaxPer30Days: "limits.sellerApplication.maxPer30Days",
  sellerApplicationPerUserPerHour: "limits.sellerApplication.perUserPerHour",
  sellerApplicationPerIpPerHour: "limits.sellerApplication.perIpPerHour",
  announcementBar: "announcement.bar",
  contactAddress: "contact.address",
  contactWorkingHours: "contact.workingHours",
  contactWhatsapp: "contact.whatsapp",
  footerTagline: "footer.tagline",
  footerLinks: "footer.links",
  maintenanceEnabled: "maintenance.enabled",
  maintenanceMessage: "maintenance.message",
} as const;
