/**
 * Settings engine registry: the only list of keys an admin can change. Server-only by convention
 * (scripts/settings-registry.test.ts fails if a "use client" file imports lib/settings).
 *
 * Every key declares its stored type (zod), the admin input (and its conversion), a safe default, bounds,
 * an Azerbaijani label and description, a group, a permission and whether a change is "sensitive".
 * The code default always applies when the key has no row, when the row is NULL, or when a stored value fails
 * validation, so the site works with an empty table.
 *
 * Never add secrets, keys, connection strings, base URLs, proxy trust, 2FA, session or CSRF policy, roles or
 * permissions here: they stay in environment variables or code. The registry test rejects such key names.
 */
import { z } from "zod";

export type SettingPermission = "settings.finance" | "settings.content";
export type SettingGroupId = "finance";

export const SETTING_GROUPS: Record<SettingGroupId, { label: string; description: string }> = {
  finance: { label: "Maliyyə", description: "Komissiya və digər maliyyə parametrləri." },
};

export type SettingInput =
  | { kind: "percent"; min: number; max: number; step: number; unit: "%" }
  | { kind: "integer"; min: number; max: number; unit?: string }
  | { kind: "text"; minLength: number; maxLength: number; multiline?: boolean };

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
  const match = /^(\d{1,2})(?:[.,](\d{1,2}))?$/.exec(percent.trim());
  if (!match) return null;
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (basisPoints > COMMISSION_MAX_BASIS_POINTS) return null;
  return `0.${String(basisPoints).padStart(4, "0")}`;
}

/** "0.1000" → "10", "0.1250" → "12.5", "0.0001" → "0.01". */
export function rateToPercent(rate: string): string {
  const basisPoints = Number(rate.slice(2));
  const whole = Math.floor(basisPoints / 100);
  const fraction = String(basisPoints % 100).padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
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

// ---- Registry ----------------------------------------------------------------------------------------------

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  commissionDefaultRate as SettingDefinition,
];

/**
 * Keys allowed despite matching the forbidden-name pattern, each with a written justification.
 * Empty today. Example of a valid future entry: a key ending in "Url" that holds a public page link.
 */
export const FORBIDDEN_NAME_EXCEPTIONS: Readonly<Record<string, string>> = {};

const byKey = new Map(SETTING_DEFINITIONS.map((definition) => [definition.key, definition]));

export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return byKey.get(key);
}

export const SETTING_KEYS = {
  commissionDefaultRate: "commission.defaultRate",
} as const;
