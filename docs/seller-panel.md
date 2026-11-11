# Seller panel: capabilities, data rules and open dependencies

Status as of 2026-11-11. This file records what the seller panel does, the rules its numbers
follow, and what is blocked on schema changes that have **not** been applied.

## Data rules

| Area | Rule | Code |
| --- | --- | --- |
| Sales | Only `DELIVERED` store orders count. Delivery already requires a `PAID` payment (`validateOrderStatusTransition`). | `lib/vendor-finance.ts` |
| Net sales | Delivered subtotal minus `REFUNDED` return amounts. Same definition as the admin monthly report (`lib/store-monthly-sales.ts`). | `summarizeVendorFinance` |
| Commission | Net sales × `StoreOrder.commissionRateSnapshot`. Orders without a snapshot are reported separately; no rate is guessed. | `summarizeVendorFinance` |
| Estimated earnings | Net sales − commission. Labelled "təxmini"; it is **not** a payout. | UI: `components/vendor-sales-report.tsx` |
| Awaiting payment | Open orders (not delivered/cancelled/returned) whose payment is not `PAID`. | `summarizeVendorFinance` |
| Stock alerts | A notification is written only when a sale moves a stock row into a worse level (OK→LOW, OK/LOW→OUT). Repeated sales at the same level do not repeat the alert. | `stockAlertCrossing` |
| Notifications | Written inside the checkout / store-review transaction, so a rolled-back or retried transaction cannot leave duplicates. | `app/api/orders/route.ts`, `app/api/admin/stores/[storeId]/review/route.ts` |
| Product code | Generated (`BGT-…`) when the seller leaves it blank. Editing a product with a blank code keeps the existing code. | `lib/product-code.ts`, `lib/vendor-product-patch.ts` |

## Authorization

- Every seller API verb resolves the store through `requireStoreAccess` (session + `VENDOR` role + `store.vendor.userId`) before doing anything; non-owners get 403/404.
- Notification reads/updates use `vendorNotificationScope(userId, storeId)`; order lists use `vendorOrderWhere(storeId, …)`. Both are pure and covered by `scripts/vendor-seller-authorization.test.mjs`.
- The seller order page shows recipient name, phone and delivery address only. The customer's e-mail is no longer loaded.

## Blocked: needs a schema change (not applied)

Each item below needs a migration. None was created or run. Proposed smallest extensions:

1. **Category-specific product properties** (brand is supported; model, warranty, material, dimensions, power are not).
   `Product.attributes Json?` plus a per-category field list in code (extend `lib/vendor-variant-suggestions.ts`).
   Size/colour/storage already work as product selections (`ProductVariant.options`).
2. **Review replies and reporting.**
   `Review.sellerReply String?`, `Review.sellerRepliedAt DateTime?`, and a `ReviewReport { id, reviewId, storeId, reason, status, createdAt }` table for admin moderation.
3. **Customer questions / messages.** No model exists. Needs a `ProductQuestion` (product, customer, question, answer, answeredAt, status) table and a customer-side form.
4. **Order status history.** Only current status and shipment timestamps are stored. Needs `StoreOrderStatusEvent { storeOrderId, fromStatus, toStatus, actorUserId, createdAt }` written in `applyStoreOrderTransition`.
5. **Seller payouts / settlements.** No settlement records exist, so the panel cannot show "completed payouts". Needs a `SellerPayout` table owned by the admin/finance flow.
6. **Subscription history and plan product limits in the database.** `StoreSubscription` is one row per store; plan limits live in code (`lib/subscription-entitlements.ts`). History needs a `StoreSubscriptionEvent` table.
7. **Notification type/link and dedupe key.** Links are currently derived from known titles (`vendorNotificationHref`). A `type`, `href` and unique `dedupeKey` column would make this explicit.
8. **Product moderation statuses** ("Gözləmədə" / "Rədd edilib" for products). `ProductStatus` is `DRAFT | ACTIVE | ARCHIVED`; products publish directly when the store is eligible.

## Not yet notified

Import job completion, subscription status changes and plan-change decisions do not create seller notifications yet. They can be added the same way as store-review notifications (inside the transaction that changes the state).
