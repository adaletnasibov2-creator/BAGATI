# Seller subscription payments via Epoint — design baseline

Status: **design approved, not implemented.** Decided 2026-11-12.
**Blocked:** do not start implementation until the owner sends Epoint's written answers to the questions in "Open questions for Epoint". The owner will supply them. When they arrive, check them against every assumption marked (assumption) below and update this file before writing code.

File and line references are as of commit `11a3a91` on `main`. Re-check them before relying on them.

## Goal

Fully automatic seller billing:

admin approves the store → seller opens the package page (BASIC 20 AZN / PRO 50 AZN) → pays by card on Epoint → a verified Epoint callback (or a server-side status check) makes the subscription ACTIVE for one billing period → the store sells without further admin action.

Money goes to BAGATI's own Epoint merchant account, with no split (assumption, until Epoint confirms).

## Owner decisions (binding)

1. **Payment is the default.** An approved store sells only with a paid, current subscription. Free access is a **manual admin grant for chosen stores**. That is a separate piece of work, the complimentary-entitlement branch. The `StoreComplimentaryEntitlement` table exists but is unused.
2. **Upgrade BASIC → PRO** takes effect immediately. A new one-month period starts today, and unused BASIC days are not refunded.
3. **Downgrade PRO → BASIC** only after the current period ends. The seller can pay for BASIC once the PRO period has expired.
4. **Refunds are manual.** The owner issues them in the Epoint merchant panel and adjusts access with the existing manual admin form. Nothing shortens a period automatically.
5. **Reminders and expiry run inside the existing email worker loop** (`scripts/process-email-outbox.ts --watch`). There is no new process or cron job for them.
6. The existing manual subscription form at `/admin/subscriptions` stays and keeps working.

## Current state (verified in code)

### Reusable from order payments

| Piece | Where | Notes |
|---|---|---|
| Signature `base64(SHA1(key + data + key))`, timing-safe compare, base64 JSON | `lib/payments/epoint-signature.ts` | reuse as is |
| Opt-in config. Disabled unless `EPOINT_PAYMENTS_ENABLED=1` and every URL/key is valid; HTTPS required | `lib/payments/epoint-config.ts:27-43` | reuse as is |
| Callback verification (size, signature, fields) | `lib/payments/epoint-protocol.ts:66-82` | reuse as is |
| Every callback is re-confirmed with the status API; amounts must match | `lib/payments/epoint-checkout.ts:88-92` | keep for subscriptions |
| Settlement rules: reference, amount, currency and `operation_code === "100"` must match; `new`/`server_error` change nothing; PAID/REFUNDED never go back to FAILED; a late success after FAILED is accepted; `returned` only after PAID | `lib/payments/epoint-protocol.ts:93-117` | generalize the type (drop `orderId`) |
| Idempotent compare-and-set, and a replay that re-reads the row | `lib/payments/epoint-settlement.ts` | reuse; add an in-transaction hook |
| Two-step start: claim the row (`providerReference = "claim:<id>"`), call Epoint, save the transaction | `lib/payments/epoint-checkout.ts:20-49` | same pattern |
| Rate limits and body cap on the callback | `app/api/payments/epoint/callback/route.ts` | the limiter is in-process memory and resets on restart |

### Not reusable as is

- `Payment` has a required `orderId` (`prisma/schema.prisma`, model `Payment`). `PaymentSnapshot` includes `orderId`, and settlement reads only `tx.payment`. **A subscription payment sent to today's callback returns 404 NOT_FOUND.**
- The create payload hard-codes `success_redirect_url`/`error_redirect_url` to `/orders/{orderId}?payment=return` and the description to `BAGATI {orderId}` (`epoint-protocol.ts:57-60`).
- No `result_url` is sent, so the callback URL is presumably configured once in the merchant panel (assumption). If so, **a single callback endpoint must serve both orders and subscriptions.**
- Settlement only updates the payment row. It has no hook for extending a subscription in the same transaction.
- The initiate and reconcile routes use `requireRole("CUSTOMER")`.
- Refunds are not implemented (`docs/production-launch.md`, "Payments and Google sign-in").

### Related behaviour

- All selling decisions go through `resolveStoreEntitlements` (`lib/subscription-entitlements.ts:35-43`), together with the Prisma filter `publicStoreEligibilityBaseWhere` (`lib/seller-legal-policy.ts:58-70`). Expiry is evaluated at read time (`periodEnd > now`), so selling stops at `currentPeriodEnd` without a job. The stored status, however, stays `ACTIVE`.
- Approving a store without a sellable subscription saves it with `isActive=false` and publishes no products (`app/api/admin/stores/[storeId]/review/route.ts:83-84`, blocker text in `lib/admin-store-product-publishing.ts:93`). The selling rule also requires `isActive`. **A payment alone would therefore leave the store hidden.** See "Store activation after payment".
- Sellers pick a plan before review. Store submission requires a subscription row (`lib/store-submission.ts:26`), which is created as PENDING (`app/api/vendor/stores/route.ts:80`, plan change in `app/api/vendor/[storeId]/[section]/route.ts`, section `subscription`).
- The manual admin route records `accessSource: "ADMIN_MANUAL"`, the admin and the reason, writes an audit entry, and sends `SUBSCRIPTION_STATUS` (`app/api/admin/[...resource]/route.ts:104-141`).
- `EmailOutbox.dedupeKey` is unique, so queueing the same email twice is a no-op. Templates are strings in `lib/email-templates.ts` and need no migration.

## Design

### Data: `SubscriptionPayment` (new table, separate from order `Payment`)

| Field | Purpose |
|---|---|
| `id` | cuid with prefix `sp_`. Sent to Epoint as `order_id` and used for routing the callback |
| `storeId`, `subscriptionId`, `planId` | FK, `ON DELETE RESTRICT` |
| `planSlugSnapshot`, `amount` Decimal(12,2), `currency` (AZN) | **snapshot at start**; the callback is checked against this, never against today's plan price |
| `periodMonths` | 1 |
| `kind` | `NEW` / `RENEWAL` / `UPGRADE`, decided at start |
| `status` | `PENDING` / `PAID` / `FAILED` / `REFUNDED` / `EXPIRED` |
| `provider`, `providerReference` | `epoint`, Epoint transaction; temporarily `claim:<id>` |
| `idempotencyKey` | unique, generated by the browser per click |
| `initiatedByUserId` | the paying seller |
| `appliedPeriodStart`, `appliedPeriodEnd` | set only when the payment is applied |
| `lastProviderStatus`, `traceId`, `paidAt`, `failedAt`, `refundedAt`, `createdAt` | audit and support |

Constraints: unique `idempotencyKey`; unique `providerReference` (excluding `claim:` values); partial unique index allowing **one started PENDING payment per store**; indexes `(storeId, createdAt)` and `(status, createdAt)`.

The migration is additive only. Existing tables are not changed. Partial indexes go in raw SQL, as in `20261109010000_store_origin_complimentary_entitlements`.

### Starting a payment

`POST /api/vendor/[storeId]/subscription/pay` with `{ planId, idempotencyKey }`. Requirements:
- `requireStoreAccess` (VENDOR who owns the store), store `status === "ACTIVE"`, store not suspended.
- The plan is active BASIC or PRO.
- Downgrade rule: PRO → BASIC is refused while a PRO period is current.

Steps:
1. In one transaction: lock the store row, create or reuse the PENDING row, claim it, and snapshot the amount and plan.
2. Call Epoint with `order_id = sp_…`, description `BAGATI abunəlik <store> <plan>`, return URLs `/vendor/[storeId]/subscription?payment=return`.
3. Save the transaction and return the redirect URL.

### Callback routing

There is one endpoint, `app/api/payments/epoint/callback`:
- `order_id` starting with `sp_` goes to the subscription settlement.
- Anything else goes to today's order path, **unchanged**. The existing order-payment tests must pass without edits.

Verification is the same for both paths: signature, then the status API, then the amount check.

### Applying a verified success (one Serializable transaction)

1. Compare-and-set the payment PENDING/FAILED → PAID. If no row changed, it is a replay: return UNCHANGED and do nothing else.
2. Lock the store and subscription rows.
3. Compute the new period:
   - `RENEWAL`, same plan, current period still running: **start = current end**, so no paid day is lost.
   - Expired, never started, or `UPGRADE` (BASIC → PRO): **start = now**. Unused BASIC days are forfeited (owner decision 2).
   - End = start + 1 calendar month, clamped to the last day of shorter months (31 Jan → 28/29 Feb). Dates are computed in Asia/Baku.
4. Update the subscription: `status = ACTIVE`, `planId`, `currentPeriodStart/End`, `startedAt` if empty, `accessSource = PAYMENT_CONFIRMED`, clear `grantedByAdminId`/`grantReason`. Record the applied period on the payment row.
5. Write an `AuditLog` entry: `SUBSCRIPTION_PAYMENT_CONFIRMED`, with the payment id, amount, plan and previous/new period.
6. Store activation, as described in the next section.
7. Queue the email `SUBSCRIPTION_PAYMENT_CONFIRMED` (dedupe key `subscription-payment:<paymentId>`).

### Store activation after payment

Change approval so that a missing subscription is **no longer a reason to save the store hidden**. The selling rule already blocks sales without a subscription. Then, in the payment transaction, call the existing `publishEligibleDraftProducts` so the store sells immediately.

A store an admin deliberately deactivated stays hidden. Payment never flips `isActive` back on.

### Failure and edge cases

| Case | Behaviour |
|---|---|
| `failed`/`error` | payment → FAILED; subscription untouched; seller may retry with a new attempt |
| Late `success` after FAILED | accepted and applied (existing settlement rule) |
| `new`/`server_error` | no change |
| No callback (timeout, abandoned) | return page and worker call the status API for PENDING rows older than about 15 min; rows with no transaction, or still unresolved after about 24 h, become EXPIRED (thresholds depend on Epoint's answers) |
| Duplicate or racing callback | compare-and-set means exactly one transaction applies the period |
| Amount, currency, plan or reference mismatch | rejected, nothing activated, logged, shown in the admin anomalies list |
| Two different payments both succeed | both applied (each payment buys one month); the second is flagged as an anomaly for the admin |
| `returned` (refund) | payment → REFUNDED, **period not changed**, anomaly flagged; owner decides via the manual form (decision 4) |
| Epoint disabled | pay route returns 503 `EPOINT_NOT_CONFIGURED`; UI shows "Kartla ödəniş tezliklə"; the manual admin form still works |

### Seller UI

- Package page `/vendor/[storeId]/subscription`:
  - BASIC 20 AZN and PRO 50 AZN, with the previously chosen plan preselected.
  - Current status and end date, and the payment history.
- **Return states:**
  - Pending: "Ödəniş yoxlanılır…". The page polls `POST …/subscription/reconcile` a few times. If still unresolved, it says: "Ödəniş hələ təsdiqlənməyib. Kartınızdan vəsait çıxılıbsa, bir neçə dəqiqə ərzində avtomatik aktivləşəcək".
  - Success: "<PLAN> paketi aktivdir — bitmə tarixi <date>", with links to products and the store.
  - Failure: "Ödəniş alınmadı", with a retry button. **Never claim whether the card was or was not charged.**
- `/vendor/subscription` stays as the list of stores.

### Emails (new templates in `lib/email-templates.ts`)

- `STORE_APPROVED_PAYMENT_REQUIRED`, or an extension of `STORE_REVIEW`: "pay to start selling", with a link.
- `SUBSCRIPTION_PAYMENT_CONFIRMED`: amount, plan, period, payment id.
- `SUBSCRIPTION_PAYMENT_FAILED`: optional.
- `SUBSCRIPTION_EXPIRING`: at 7, 3 and 1 days before the end.
- `SUBSCRIPTION_EXPIRED`.

### Admin

Additions to `/admin/subscriptions`, with the manual form kept unchanged:
- Filters: paid (`PAYMENT_CONFIRMED`), payment pending, expiring within 7 days, expired, manual/free.
- Summary counts at the top.
- Per-store payment history: amount, plan, period, Epoint transaction, status.
- An **anomalies** list: mismatches, refunds, double payments.
- A manual change that would shorten a paid period asks for confirmation and is audited.

### Reminders and expiry (inside the email worker loop, decision 5)

Each worker poll runs a cheap step that may run any number of times. It is throttled to about once every 15 minutes, using a timestamp in the worker's heartbeat or state.

1. Queue `SUBSCRIPTION_EXPIRING` for subscriptions ending in ≤7, ≤3 or ≤1 days. Dedupe key `sub-expiring:<subscriptionId>:<periodEndISO>:<7|3|1>`, so each reminder is sent once per period.
2. Set `status = EXPIRED` where `currentPeriodEnd <= now` and the status is still ACTIVE (cosmetic, because selling already stops at read time). Queue `SUBSCRIPTION_EXPIRED` (dedupe `sub-expired:<subscriptionId>:<periodEndISO>`).
3. Reconcile stale PENDING subscription payments through the status API, but only when Epoint is enabled.

The worker already runs as one supervised process (PM2 on Cloudways; see `docs/transactional-email.md` and `docs/production-launch.md`). No new process or cron job is added.

## Open questions for Epoint (implementation is blocked until answered in writing)

1. Callback URL: set in the merchant panel only, or per request (`result_url`)? Can orders and subscriptions use different URLs?
2. Callback retries: which HTTP statuses trigger a retry, how often and for how long? Can callbacks for one transaction arrive out of order? (Today a status-check failure returns 503.)
3. Status API: exact response fields, final statuses, rate limits, and how long a transaction stays queryable.
4. Timeouts: how long the payment page is valid; whether an abandoned payment ever produces a callback.
5. Refunds: API or merchant panel only; partial refunds; is a `returned` callback always sent?
6. `operation_code`: all possible values besides `100`.
7. Is SHA1 still the signature scheme? Is there an IP allowlist for callback sources?
8. Can BAGATI's own subscription fees go to the same merchant account and category as customer orders? Fees, payout timing, any split requirement.
9. Sandbox: test cards, sandbox callback delivery.
10. (Later, out of scope) Saved cards for automatic renewal.

Separate, for the owner's accountant: the receipt, e-invoice or VAT document required for a 20 or 50 AZN subscription charge.

## Implementation plan (for when the block is lifted)

**Branch:** `feature/epoint-subscriptions` from `main`, after the complimentary-entitlement branch is merged. Both touch the admin subscriptions page and the store review route.

**Files to change:**
- `lib/payments/epoint-protocol.ts`: parameterize return URLs and description; generalize the snapshot type.
- `lib/payments/epoint-settlement.ts`: in-transaction side-effect hook.
- `lib/payments/epoint-checkout.ts`: `sp_` routing.
- New `lib/payments/subscription-billing.ts` (start, apply, reconcile) and `lib/subscription-period.ts` (period maths).
- New `app/api/vendor/[storeId]/subscription/pay/route.ts` and `.../reconcile/route.ts`.
- Vendor subscription section page.
- `app/api/admin/stores/[storeId]/review/route.ts` and `lib/admin-store-product-publishing.ts`: activation rule.
- Admin subscriptions page.
- `lib/email-templates.ts`.
- `scripts/process-email-outbox.ts`: billing step.
- `prisma/schema.prisma` and the migration.
- Docs.

**Tests:**
- Unit:
  - Period maths: renewal, expired, upgrade, month-end clamp, Baku time zone.
  - `sp_` routing.
  - Every settlement case in the table above.
  - The downgrade rule.
- Existing order-payment tests pass unchanged.
- Integration on the guarded test database (127.0.0.1:5433, name contains `verify`, never 5432), with a fake Epoint signing with a test key:
  - Pay → ACTIVE → store sells.
  - A replayed callback does not add a month.
  - Concurrent callbacks.
  - Mismatch → nothing activated.
  - Another seller's store → 403; an unapproved store → 409.
  - The billing step queues each reminder once, even when run twice.
- Static: only the manual admin route and `subscription-billing` write subscription periods.

**Rollout, with Epoint kept disabled until sandbox tests pass:**
1. Deploy code and migration with `EPOINT_PAYMENTS_ENABLED` unset and a second switch `EPOINT_SUBSCRIPTIONS_ENABLED` unset. The pay button shows "coming soon"; the manual form works.
2. Staging with sandbox keys: success, failure, abandonment, duplicate callback, `returned` if the sandbox can send it.
3. Epoint's written answers checked against this file; assumptions updated.
4. Production keys with the subscription switch on for one owner test payment of 20 AZN, then refund it manually.
5. Open the flow to sellers.

**Rollback:** turn the subscription switch off. Paid periods remain valid, and the table stays.

**Risks:**
- A callback URL that only knows about orders (question 1).
- Retries that stop after our 503 (question 2).
- Unclear refund semantics.
- The in-memory rate limiter resetting on restart.
- Time zone and month-end bugs.
- A store staying hidden after payment if the activation rule is skipped.
