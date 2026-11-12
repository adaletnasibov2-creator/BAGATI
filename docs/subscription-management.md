# BAGATI subscription access policy

## Plan entitlements

Active BASIC and PRO subscriptions both include CSV/XLSX bulk product import. The server uses `getStoreEntitlements` and `assertFeature` for the vendor import endpoint; the vendor navigation uses the same entitlement result. Pending, suspended, cancelled, expired, inactive-plan, and out-of-period subscriptions do not grant import access. Store approval, legal review, city/vendor account status, and store activation remain separate requirements for customer-facing sale eligibility.

## Administrator-managed access

The existing `/admin/subscriptions` page lists stores with and without a subscription record. An ADMIN can assign BASIC or PRO, set the subscription status and period, and suspend, reactivate, or revoke access. Every change requires a reason. Changes are stored as `ADMIN_MANUAL`, identify the acting administrator, and write an `AuditLog` entry containing the prior and new plan/status/period plus reason. This operation does not create a payment, invoice, or payment confirmation. Existing subscription records receive `UNKNOWN` as their source after migration; that value intentionally does not infer whether an old record was paid or manually granted.

The separate store activation and seller legal approval workflow remains in force. An active subscription alone does not approve a seller, approve legal information, or activate a store for public sales. Admin-managed stores retain the existing explicit entitlement override; no other subscription status bypass is introduced.

## Database migration

The schema change is additive. Before deployment, review and apply `20261020000000_admin_subscription_management` through the established migration process. It adds an access-source enum and nullable administrator/reason fields, with a safe `UNKNOWN` default for existing rows. It does not change existing statuses, plan assignments, users, stores, orders, or payments. Do not apply it to production without the normal backup and controlled deployment process.

Plan prices continue to come from the existing `SubscriptionPlan` rows and are not changed here. No payment provider is integrated. The approved design for automatic card payments through Epoint, not yet implemented, is in `docs/epoint-subscription-payments.md`.

## Admin free selling ("Ödənişsiz satış (admin icazəsi)")

Decided 2026-11-12. There are two separate paths to selling:

1. **Normal seller (default).** Approval still requires an ACTIVE, in-period paid BASIC or PRO subscription. Approving without one leaves the store approved but hidden, with the subscription blocker. Until card payments exist, the admin sets the subscription ACTIVE by hand on `/admin/subscriptions`.
2. **Admin-granted free store.** The approve form has an unticked checkbox "Ödənişsiz satış (admin icazəsi)". Only when it is ticked does approval create a `StoreComplimentaryEntitlement` row, in the same transaction, after the store update. The row has: tier BASIC by default or PRO, an optional end date, a required reason, and the approving admin. The blockers are then computed with the grant, so the store is published and its eligible draft products are published.

Rules:

- The sell rule has two copies that must stay identical: `resolveStoreEntitlements` (`lib/subscription-entitlements.ts`) and the SQL filter `publicStoreEligibilityBaseWhere` (`lib/seller-legal-policy.ts`). A store sells when its base checks pass and it is admin-managed, has a current paid subscription, or has an unrevoked grant whose end date (if any) is in the future.
  - Plan precedence: the paid plan first, then the grant tier, then BASIC for admin-managed stores.
  - The grant is a required input of the JS rule and of every state type built from it.
  - `scripts/complimentary-entitlement-rule.test.ts` checks SQL/JS parity over 7 168 combinations and that every caller loads the grant.
- The end date is a calendar day, stored as 00:00 UTC (the same convention as the manual subscription form). Selling stops at that moment, evaluated on every request, with no scheduled job.
- Grants are changed only through `lib/complimentary-entitlements.ts`.
  - From the store page or `/admin/subscriptions`, an admin can grant, change the tier or end date, or revoke. Every action requires a reason (at least 8 characters) and writes an `ADMIN_COMPLIMENTARY_*` audit entry.
  - A change revokes the current row and creates a new one, so the table keeps the full history.
  - The database allows at most one unrevoked grant per store.
- Saving an ACTIVE paid subscription in the manual form revokes the grant in the same transaction (audit source `PAID_SUBSCRIPTION_ACTIVATED`).
- Free limits follow the tier: BASIC 300 active products, PRO 2 000.
- The public PRO badge reflects paid PRO only. A free PRO grant does not show it.
- There is no seller email for grants in this phase. Already-approved stores were not backfilled.
- Migration `20261112010000_complimentary_entitlement_tier_ends_at` is additive (enum, two columns, one CHECK). It depends on `20261109010000_store_origin_complimentary_entitlements`. Apply both only through the reviewed deployment process.
