# BAGATI subscription access policy

## Plan entitlements

Active BASIC and PRO subscriptions both include CSV/XLSX bulk product import. The server uses `getStoreEntitlements` and `assertFeature` for the vendor import endpoint; the vendor navigation uses the same entitlement result. Pending, suspended, cancelled, expired, inactive-plan, and out-of-period subscriptions do not grant import access. Store approval, legal review, city/vendor account status, and store activation remain separate requirements for customer-facing sale eligibility.

## Administrator-managed access

The existing `/admin/subscriptions` page lists stores with and without a subscription record. An ADMIN can assign BASIC or PRO, set the subscription status and period, and suspend, reactivate, or revoke access. Every change requires a reason. Changes are stored as `ADMIN_MANUAL`, identify the acting administrator, and write an `AuditLog` entry containing the prior and new plan/status/period plus reason. This operation does not create a payment, invoice, or payment confirmation. Existing subscription records receive `UNKNOWN` as their source after migration; that value intentionally does not infer whether an old record was paid or manually granted.

The separate store activation and seller legal approval workflow remains in force. An active subscription alone does not approve a seller, approve legal information, or activate a store for public sales. Admin-managed stores retain the existing explicit entitlement override; no other subscription status bypass is introduced.

## Database migration

The schema change is additive. Before deployment, review and apply `20261020000000_admin_subscription_management` through the established migration process. It adds an access-source enum and nullable administrator/reason fields, with a safe `UNKNOWN` default for existing rows. It does not change existing statuses, plan assignments, users, stores, orders, or payments. Do not apply it to production without the normal backup and controlled deployment process.

Plan prices continue to come from the existing `SubscriptionPlan` rows and are not changed here. No payment provider is integrated.
