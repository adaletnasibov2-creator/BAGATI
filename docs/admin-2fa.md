# Admin two-factor authentication (2FA) and admin sessions

## What admins see

- **Login:** e-mail and password first. An admin with 2FA then enters the 6-digit code from an authenticator app
  (Google Authenticator, Microsoft Authenticator, 1Password, …) or one of the recovery codes. **No session exists
  until both steps pass**; between them the browser only holds a 5-minute signed challenge cookie
  (`bagati_admin_2fa`, HttpOnly, SameSite=Strict, path `/api/admin`) that cannot be used as a session.
- **Hesab təhlükəsizliyi** (`/admin/security`): change password, turn 2FA on (QR code generated on our server, plus a
  manual key; one valid code activates it; 10 recovery codes are shown once), turn 2FA off (password + current
  code; not possible while 2FA is required).
- **Aktiv sessiyalar** (`/admin/security/sessions`): the admin's own sessions with creation time, last activity,
  masked IP (only when `BAGATI_TRUST_CLOUDFLARE_IP=true`), a short browser summary and a "Bu cihaz" marker. End one
  session or **Bütün digər sessiyaları bağla**.
- Password change, 2FA activation and 2FA deactivation end all other sessions of that admin.

## Rules

| Rule | Value |
|---|---|
| TOTP | RFC 6238, HMAC-SHA1, 6 digits, 30 s step, ±1 step accepted |
| Replay | a code (time step) can be used once; older steps are refused |
| Lockout | 5 consecutive wrong codes → 2FA locked for 15 minutes |
| Rate limit | 10 code attempts / 15 min per admin, 30 / 15 min per client IP (when the trusted Cloudflare IP is available) |
| Recovery codes | 10, single use, `XXXXX-XXXXX`, stored as scrypt hashes, shown once |
| Admin session lifetime | 12 hours (customers and sellers: unchanged, 7 days) |
| Admin idle timeout | 2 hours without a request |

Audit actions: `ADMIN_2FA_ENROLLED`, `ADMIN_2FA_DISABLED`, `ADMIN_2FA_FAILED`, `ADMIN_2FA_LOCKED`,
`ADMIN_2FA_RECOVERY_CODE_USED`, `ADMIN_SESSION_REVOKED`, `ADMIN_SESSIONS_REVOKED`. Metadata never contains codes,
secrets or hashes; a revoked session is identified by the first 8 characters of its id. Wrong codes are also
recorded in the Security Center as `LOGIN_FAILURE` on `/api/admin/login/2fa`, and a lockout or rate limit as
`RATE_LIMIT_VIOLATION`.

## Server settings (Cloudways → Application → Environment variables)

| Name | Required | Value |
|---|---|---|
| `BAGATI_ADMIN_2FA_KEY` | to enable 2FA | 32 random bytes, base64 (or 64 hex characters). Generate once: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Never** reuse `SESSION_SECRET`. |
| `BAGATI_ADMIN_2FA_REQUIRED` | no | `true` forces every admin to have 2FA. Default (unset/anything else): optional, but enforced for every admin who enrolled. |

- The key encrypts the TOTP secrets (AES-256-GCM). It is **not** derived from `SESSION_SECRET` and there is no
  fallback. Without it: enrollment is disabled with a clear message and admins without 2FA log in as before.
- Keep a copy of the key in the password manager. **If the key is lost or changed**, enrolled admins can no
  longer use authenticator codes; they can still sign in with a recovery code (recovery codes do not use the key),
  then turn 2FA off and on again with the new key.
- Set `BAGATI_ADMIN_2FA_REQUIRED=true` only after the key is set and every admin has enrolled. If the flag is
  true and the key is missing, admins without 2FA cannot log in (they get a clear error).

## The last admin must keep the recovery codes

There is a single ADMIN account in production. If that admin loses the phone **and** the recovery codes, nobody
can sign in to the admin panel; the only way back is the database reset below. Store the recovery codes offline
(password manager or printed in a safe place), not on the same phone.

## Manual reset for a locked-out admin (database)

Use only after confirming the person's identity outside the website. Take a database backup first. Replace the
e-mail on the marked line. The block aborts unless exactly one active ADMIN has that e-mail. It removes the
second factor and the recovery codes of that admin, ends all of their sessions and writes an audit entry. If
`BAGATI_ADMIN_2FA_REQUIRED=true`, the admin is asked to enroll again at the next login.

```sql
BEGIN;
DO $$
DECLARE
  target_id text;
BEGIN
  SELECT "id" INTO STRICT target_id
  FROM "User"
  WHERE "email" = lower('admin@example.com')   -- <<< replace with the admin's e-mail
    AND "role" = 'ADMIN';
  DELETE FROM "AdminRecoveryCode" WHERE "userId" = target_id;
  DELETE FROM "AdminTwoFactor" WHERE "userId" = target_id;
  UPDATE "AuthSession" SET "revokedAt" = now() WHERE "userId" = target_id AND "revokedAt" IS NULL;
  INSERT INTO "AuditLog" ("id", "actorId", "action", "entityType", "entityId", "metadata", "createdAt")
  VALUES (gen_random_uuid()::text, NULL, 'ADMIN_2FA_RESET_MANUAL', 'User', target_id, '{"via":"sql"}'::jsonb, now());
  RAISE NOTICE '2FA removed and sessions revoked for user %', target_id;
END
$$;
COMMIT;
```

`SELECT … INTO STRICT` raises an error (and nothing is changed) when no row or more than one row matches.

## Production rollout order

1. Back up the database and verify the backup.
2. Import `release-output/prod-migration-20261113020000.sql` (guarded, one transaction). It aborts on a second run.
3. Deploy the application build of this branch.
4. Add `BAGATI_ADMIN_2FA_KEY` in Cloudways and restart the application.
5. The admin opens **Hesab təhlükəsizliyi**, enrolls, and stores the recovery codes offline. Log out and log in once
   to confirm the code step.
6. Optional, later: set `BAGATI_ADMIN_2FA_REQUIRED=true` and restart.

Rollback: revert to the previous build first, then run `release-output/prod-migration-20261113020000.rollback.sql`
(it refuses to run while 2FA data exists, so no enrolled secret is dropped silently).
