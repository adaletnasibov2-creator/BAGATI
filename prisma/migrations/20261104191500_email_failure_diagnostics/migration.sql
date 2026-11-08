-- Additive diagnostics for future email delivery failures.
-- Existing rows keep NULL in the new columns. This migration does not update or retry them.

ALTER TABLE "EmailOutbox" ADD COLUMN "failureCategory" TEXT;
ALTER TABLE "EmailOutbox" ADD COLUMN "smtpCodeClass" TEXT;
ALTER TABLE "EmailOutbox" ADD COLUMN "failedAt" TIMESTAMP(3);

ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_failureCategory_check"
  CHECK (
    "failureCategory" IS NULL OR "failureCategory" IN (
      'DNS_FAILURE',
      'CONNECTION_TIMEOUT',
      'CONNECTION_REFUSED',
      'CONNECTION_RESET',
      'NETWORK_ERROR',
      'TLS_FAILURE',
      'SMTP_TEMPORARY',
      'SMTP_PERMANENT',
      'SMTP_AUTHENTICATION',
      'SMTP_CONFIGURATION',
      'PAYLOAD_DECRYPTION',
      'MESSAGE_REJECTED',
      'UNKNOWN'
    )
  );

ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_smtpCodeClass_check"
  CHECK ("smtpCodeClass" IS NULL OR "smtpCodeClass" IN ('4xx', '5xx'));
