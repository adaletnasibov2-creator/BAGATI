# Seller account approval — next phase (Option B)

Status: planned, not implemented. Decided 2026-11-12.

## Where things stand after Option A

- Google creates only CUSTOMER accounts, and only from the customer pages. The seller login page signs in existing sellers only.
- `/vendor/register` redirects to `/register?next=/vendor/apply`; `/api/auth/vendor-register` returns 410.
- `/api/vendor/apply` is unchanged. It still switches the account from CUSTOMER to VENDOR **immediately** when the application is submitted.
- Admin approval exists only per **store** (`DRAFT → PENDING_REVIEW → ACTIVE / REJECTED / SUSPENDED`). A store is public only when it is approved. The VENDOR role itself is not approved by anyone.
- Until approval, a new seller can open the seller panel, create draft stores and products, run imports and upload images. `requireStoreAccess` checks role and ownership, not store status.
- Existing VENDOR accounts were not changed.

## Option B: account-level approval

Goal: becoming a seller means customer account + seller application + admin approval. The account stays CUSTOMER until an admin approves it.

What B needs:

1. **Data model** (migration): a `SellerApplication` table, or an approval status on `VendorProfile` (`PENDING`, `APPROVED`, `REJECTED`), plus `submittedAt`, `reviewedAt`, `reviewedById` and `reviewNote`. Pick one place to hold the status.
2. **`/api/vendor/apply`**: store the application without changing the role. Block duplicate pending applications, and allow a new application after a rejection.
3. **Admin queue**: list pending applications. Approve sets the role to VENDOR in the same transaction as the status change and writes an audit log entry. Reject requires a reason. Both send an email (new templates, e.g. `SELLER_APPLICATION_APPROVED` / `_REJECTED`).
4. **Applicant view**: a customer-side status page (pending / approved / rejected with the reason). `/vendor/apply` should show that page instead of the form while an application is pending.
5. **Application content**: decide which seller details are collected up front (seller type, legal name, VÖEN, legal address, phone), because store creation and legal review currently happen after the role switch.
6. **Existing sellers**: mark current VENDOR accounts as approved (grandfathered) in the migration, so nobody loses access. Agree how accounts created through the old self-registration are treated.
7. **Copy**: `/vendor/apply` currently says the role switches on submission. Update it, and update the seller-not-found message to mention waiting for approval of the application.
8. **Tests**: the role stays CUSTOMER after applying; only an admin can approve; seller login is refused while pending; grandfathered sellers keep access; no Google path can grant VENDOR.

Open questions for the owner: one application per account or several over time; whether a rejected applicant can reapply right away; whether store creation should be possible before account approval (B removes it unless allowed).
