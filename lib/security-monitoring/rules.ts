/**
 * Security Center alert rules: code-defined, with defaults; admins may override enabled/threshold/window/cooldown
 * (SecurityAlertRule rows). Pure module (no database): the evaluation that reads data lives in jobs.ts.
 */
import { z } from "zod";

export type RuleMetric =
  | "events.loginFailure"
  | "events.twoFactorFailure"
  | "stats.authDenied"
  | "stats.notFound"
  | "stats.status5xx"
  | "stats.rateLimited"
  | "stats.ipMismatches";

export type RuleSettings = { enabled: boolean; threshold: number; windowMinutes: number; cooldownMinutes: number };
export type SecuritySeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type AlertRuleDefinition = {
  key: string;
  label: string;
  description: string;
  metric: RuleMetric;
  severity: SecuritySeverity;
  defaults: RuleSettings;
};

/** Bounds shared by every rule (same as the database CHECK on SecurityAlertRule). */
export const RULE_BOUNDS = { threshold: [1, 100_000], windowMinutes: [1, 1440], cooldownMinutes: [1, 10_080] } as const;

/** Paths of the admin second factor (login code step and disabling 2FA). */
export const TWO_FACTOR_PATHS = ["/api/admin/login/2fa", "/api/admin/2fa/disable"] as const;

export const SECURITY_ALERT_RULES: readonly AlertRuleDefinition[] = [
  {
    key: "login_failure_burst", metric: "events.loginFailure", severity: "HIGH",
    label: "Uğursuz giriş partlayışı",
    description: "Bütün giriş formalarında (müştəri, satıcı, admin) qısa müddətdə çoxlu uğursuz giriş.",
    defaults: { enabled: true, threshold: 30, windowMinutes: 5, cooldownMinutes: 30 },
  },
  {
    key: "auth_denied_spike", metric: "stats.authDenied", severity: "MEDIUM",
    label: "401/403 cavablarında artım",
    description: "İzlənən API-lərdə icazəsiz (401) və qadağan (403) cavabların sayı həddi keçir.",
    defaults: { enabled: true, threshold: 50, windowMinutes: 5, cooldownMinutes: 30 },
  },
  {
    key: "not_found_scan", metric: "stats.notFound", severity: "MEDIUM",
    label: "404 skan partlayışı",
    description: "Mövcud olmayan səhifə və fayllara (məsələn .php, mühit faylları, wp-admin) çoxlu sorğu: avtomatik skan əlaməti.",
    defaults: { enabled: true, threshold: 100, windowMinutes: 10, cooldownMinutes: 60 },
  },
  {
    key: "server_error_spike", metric: "stats.status5xx", severity: "HIGH",
    label: "5xx server xətalarında artım",
    description: "İzlənən API-lərdə server xətalarının sayı həddi keçir.",
    defaults: { enabled: true, threshold: 20, windowMinutes: 5, cooldownMinutes: 15 },
  },
  {
    key: "rate_limit_spike", metric: "stats.rateLimited", severity: "MEDIUM",
    label: "429 (limit) cavablarında artım",
    description: "Sorğu limitinə düşən cavabların sayı həddi keçir.",
    defaults: { enabled: true, threshold: 50, windowMinutes: 5, cooldownMinutes: 30 },
  },
  {
    key: "ip_header_mismatch", metric: "stats.ipMismatches", severity: "HIGH",
    label: "IP başlıqları uyğun gəlmir",
    description: "CF-Connecting-IP və X-Real-IP fərqlidir; müştəri IP-si etibarsız sayılır. Proxy qurğusu yoxlanılmalıdır.",
    defaults: { enabled: true, threshold: 1, windowMinutes: 10, cooldownMinutes: 60 },
  },
  {
    key: "two_factor_failures", metric: "events.twoFactorFailure", severity: "CRITICAL",
    label: "Admin 2FA uğursuzluqları",
    description: "Admin iki mərhələli təsdiq kodunun ardıcıl səhv daxil edilməsi.",
    defaults: { enabled: true, threshold: 5, windowMinutes: 10, cooldownMinutes: 30 },
  },
];

export function getAlertRule(key: string): AlertRuleDefinition | undefined {
  return SECURITY_ALERT_RULES.find((rule) => rule.key === key);
}

export const ruleSettingsSchema = z.object({
  enabled: z.boolean(),
  threshold: z.number().int().min(RULE_BOUNDS.threshold[0]).max(RULE_BOUNDS.threshold[1]),
  windowMinutes: z.number().int().min(RULE_BOUNDS.windowMinutes[0]).max(RULE_BOUNDS.windowMinutes[1]),
  cooldownMinutes: z.number().int().min(RULE_BOUNDS.cooldownMinutes[0]).max(RULE_BOUNDS.cooldownMinutes[1]),
}).strict();

/** Effective settings: the override row when present and valid, otherwise the code default. */
export function effectiveRuleSettings(rule: AlertRuleDefinition, override: RuleSettings | null | undefined): RuleSettings & { isDefault: boolean } {
  if (override) {
    // Only the four settings: a database row also carries key, version, updatedAt (the schema is strict).
    const { enabled, threshold, windowMinutes, cooldownMinutes } = override;
    const parsed = ruleSettingsSchema.safeParse({ enabled, threshold, windowMinutes, cooldownMinutes });
    if (parsed.success) return { ...parsed.data, isDefault: false };
  }
  return { ...rule.defaults, isDefault: true };
}

/**
 * Whether a measured value opens a new incident: the rule is enabled, the value reached the threshold, and the last
 * incident of the same rule is older than the cooldown (so one burst produces one incident).
 */
export function shouldOpenIncident(input: { settings: RuleSettings; value: number; lastIncidentAt: Date | null; now: Date }): boolean {
  if (!input.settings.enabled || input.value < input.settings.threshold) return false;
  if (!input.lastIncidentAt) return true;
  return input.now.getTime() - input.lastIncidentAt.getTime() >= input.settings.cooldownMinutes * 60_000;
}

export function incidentTitle(rule: AlertRuleDefinition, value: number, settings: RuleSettings): string {
  return `${rule.label}: ${value} (hədd ${settings.threshold}, ${settings.windowMinutes} dəq)`.slice(0, 160);
}
