# BAGATI Google OAuth

Customer and vendor Google sign-in use the existing PostgreSQL-backed BAGATI session. Google tokens are verified server-side against Google's JWKS, issuer, audience, verified-email claim, and the per-request OIDC nonce. Authorization uses signed, short-lived `state`, an HttpOnly/SameSite cookie, and S256 PKCE. Client credentials are server-only.

Google login never creates an account or changes a role. Registration is separate: the customer registration page creates a `CUSTOMER`; the vendor registration page creates a `VENDOR` and vendor profile, but does not create a store or approve selling. Google `ADMIN` sign-in is not available. A pre-existing account with the same verified email is not automatically linked. The user must first sign in through the existing method, then start Google linking from the account security page. Linking requires the same active BAGATI session, matching account role, matching verified email, signed OAuth state, nonce, and PKCE verification. The flow does not merge users or replace an existing Google identity; unlinking is not available.

## Configuration

Set these variables in the relevant process secret store; never put values in client code:

| Variable | Local | Production |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | Google OAuth web client ID | Same client or separate production web client |
| `GOOGLE_CLIENT_SECRET` | Matching client secret | Matching production client secret |
| `APP_BASE_URL` | `http://localhost:3000` | `https://shopbagati.com` |
| `SESSION_SECRET` | Existing random secret, at least 32 characters | Stable production secret, at least 32 characters |

Credentials are absent from the inspected local `.env` and `.env.local`; OAuth is therefore not active yet. Adding blank or example values does not enable it. Do not set the public origin to a Cloudflare Tunnel hostname for production.

## Google Cloud Console

1. Select/create the BAGATI Google Cloud project and configure the OAuth consent screen with the correct product name, support contact, authorized domain `shopbagati.com`, privacy policy, and terms URLs. Publish/verify the consent screen as required for the requested user population; while in Testing, add only approved test accounts.
2. Create an OAuth client of type **Web application**.
3. Add the exact authorized redirect URI `http://localhost:3000/api/auth/google/callback` for local development.
4. Add the exact authorized redirect URI `https://shopbagati.com/api/auth/google/callback` for production.
5. If Google requires an authorized domain, verify `shopbagati.com` in Search Console and the Google consent configuration. This application uses the server-side authorization-code flow; it does not need a browser JavaScript origin or an exposed client secret.
6. Put the client ID in server-side `GOOGLE_CLIENT_ID` and secret in `GOOGLE_CLIENT_SECRET`; configure the matching `APP_BASE_URL` for each environment. Restart the app after changing environment values.

Production callbacks always use the canonical apex origin. Requests for `www.shopbagati.com` are configured to receive an HTTPS 308 redirect to `shopbagati.com`, preserving path/query. This is needed so the host-only OAuth state cookie remains on the callback domain. The www redirect could not be verified against the live site from this environment: requests to both production hostnames returned Cloudflare HTTP 530 before reaching the Next.js application. Confirm the Cloudflare Tunnel/DNS route and host preservation before production OAuth testing; no tunnel or DNS configuration was changed here.

## Account creation and recovery

Google registration creates the role-specific profile, marks email verified only after a verified Google ID token, and queues the existing welcome email. It does not grant admin authority, create/activate a store, or bypass vendor onboarding. The `GoogleAccount` table maps the immutable Google subject to one existing BAGATI user. Existing same-email accounts are rejected instead of silently merged. A logged-in customer/vendor can explicitly link their matching verified Google identity from the customer or vendor security page; a Google identity already linked elsewhere cannot be moved.

New accounts created through Google registration have `passwordAuthEnabled=false`; they use Google sign-in and do not receive password-reset tokens. Explicitly linking Google to an existing account does not change that account's password setting, so an existing local password remains usable. A `GoogleAccount` row alone cannot establish whether an older BAGATI account was created with Google or later linked to it. Neither pending password-provider migration updates user rows based on that relationship: the first adds the flag with a `true` default, and the follow-up is intentionally a no-op. This preserves the existing password-capable behavior for all legacy users, without claiming to identify their original provider. As a result, legacy Google-only accounts may use password recovery if they control the registered email inbox; the application cannot distinguish them from password accounts that later linked Google. Recovery remains rate-limited, uses a generic response, and requires the one-time expiring email link. New reset links carry the token in the URL fragment; the browser removes it from the address bar before submission, and sends it only in the HTTPS request body. Only newly created Google registrations have password sign-in explicitly disabled.

The `GoogleAccount` schema requires the additive migration `20261015130000_google_oauth_accounts`; password-provider tracking requires `20261016010000_password_auth_provider` and `20261016020000_preserve_linked_password_auth`. The provider migration only adds a non-null boolean with a `true` default; it does not classify or update existing users based on Google links. The follow-up migration is intentionally a no-op, retained as a migration-history marker so no account-origin inference is performed. Neither migration changes profile, order, or Google-link rows. Google registration code explicitly disables password sign-in only for newly created Google accounts, while the explicit linking flow leaves the existing password setting untouched. Because a modified migration file changes its checksum, verify migration status in every target environment before deployment. If either original version has already been applied anywhere, stop and prepare a separately reviewed forward-only remediation; do not edit or replay an applied migration. Verify a fresh backup before applying. These migrations have not been applied as part of this code change.

## Email delivery

Order-created customer confirmation, vendor new-order, order-status, account-security, registration verification/welcome, and password-reset messages already use the transactional `EmailOutbox` and Nodemailer SMTP worker. The web request queues mail transactionally; the separate worker must be supervised in every deployment. Never run a general worker against a shared database as a test when unrelated eligible messages may exist.

Current local SMTP configuration is Gmail SMTP; required variable names are `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`. The previous controlled message was accepted and received, with Gmail reporting SPF/DKIM/DMARC pass and `gmail.com` sender/Return-Path/DKIM domains, but it landed in Spam. No further message was sent during the current task. SMTP connectivity and provider acceptance are not proof of inbox placement.

For production branded delivery, select an SMTP provider that supports your verified sending domain, configure its provider-specific SPF and DKIM records and an aligned DMARC policy, then set its SMTP host/port/credentials and a verified `SMTP_FROM` address. Do not copy Gmail credentials or send as `@shopbagati.com` until the provider authorizes the domain. DNS changes and provider purchases require owner approval.

Set production `APP_BASE_URL=https://shopbagati.com` so recovery links and OAuth callbacks use the public canonical host. The inspected local `.env.local` contains a localhost origin; no production process environment was available to inspect.

## Validation

After configuring Google Cloud and applying the reviewed migrations, test first with a dedicated Google test account and the local callback. Confirm first-time customer/vendor profile creation (password sign-in disabled), repeat login preserving linked records, role mismatch rejection, callback state/nonce failures, existing-email conflict, existing local-password login after explicitly linking Google, and password recovery behavior for new Google-only versus legacy/linked accounts. Run the email worker only against a dedicated test database/outbox or after explicitly approving every eligible recipient. No Google credentials or database migration were applied as part of this implementation.
