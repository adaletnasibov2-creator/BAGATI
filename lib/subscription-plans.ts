export const supportedSubscriptionPlanSlugs = ["basic", "pro", "professional"] as const;

export type EntitlementPlan = "BASIC" | "PRO";

export function resolveSubscriptionPlanSlug(slug: string | null): EntitlementPlan | null {
  switch (slug?.toLowerCase()) {
    case "basic":
      return "BASIC";
    case "pro":
    case "professional":
      return "PRO";
    default:
      return null;
  }
}
