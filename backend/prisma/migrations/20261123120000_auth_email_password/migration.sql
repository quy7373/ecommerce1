-- AUTH-002: Email/Password Authentication additive migration
-- Preserves existing User IDs, Google subjects, carts, orders, and sessions.
-- Does NOT blindly backfill emailVerifiedAt for existing rows.

-- 1. Check for normalized email collisions before enforcing normalized lowercase email
DO $$
DECLARE
  collision_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO collision_count
  FROM (
    SELECT lower(btrim("email")) AS norm_email
    FROM "User"
    GROUP BY lower(btrim("email"))
    HAVING COUNT(*) > 1
  ) collisions;

  IF collision_count > 0 THEN
    RAISE EXCEPTION 'AUTH-002 migration aborted: % normalized email collision(s) detected in User table. Resolve manually without auto-merging.', collision_count;
  END IF;
END $$;

-- Normalize existing User emails safely (trim + lowercase)
UPDATE "User"
SET "email" = lower(btrim("email"))
WHERE "email" <> lower(btrim("email"));

-- 2. Make User.googleSubject nullable and add User.emailVerifiedAt
ALTER TABLE "User"
  ALTER COLUMN "googleSubject" DROP NOT NULL;

ALTER TABLE "User"
  ADD COLUMN "emailVerifiedAt" TIMESTAMPTZ(6);

-- 3. Create AUTH-002 enums
CREATE TYPE "AuthActionTokenPurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');
CREATE TYPE "AuthMailTemplate" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD', 'PASSWORD_CHANGED');
CREATE TYPE "AuthMailOutboxStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- 4. Create PasswordCredential (one local credential per user)
CREATE TABLE "PasswordCredential" (
  "userId" UUID NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "passwordChangedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PasswordCredential_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "PasswordCredential_version_check" CHECK ("version" >= 1),
  CONSTRAINT "PasswordCredential_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 5. Create AuthActionToken (one-time SHA-256 hashed action tokens)
CREATE TABLE "AuthActionToken" (
  "id" UUID NOT NULL,
  "purpose" "AuthActionTokenPurpose" NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "email" TEXT NOT NULL,
  "userId" UUID,
  "credentialVersion" INTEGER,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "consumedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuthActionToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthActionToken_tokenHash_key" UNIQUE ("tokenHash"),
  CONSTRAINT "AuthActionToken_purpose_binding_check" CHECK (
    ("purpose" = 'VERIFY_EMAIL' AND "userId" IS NULL AND "credentialVersion" IS NULL)
    OR
    ("purpose" = 'RESET_PASSWORD' AND "userId" IS NOT NULL AND "credentialVersion" IS NOT NULL AND "credentialVersion" >= 1)
  ),
  CONSTRAINT "AuthActionToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "AuthActionToken_purpose_email_expiresAt_idx"
  ON "AuthActionToken"("purpose", "email", "expiresAt");

CREATE INDEX "AuthActionToken_userId_purpose_expiresAt_idx"
  ON "AuthActionToken"("userId", "purpose", "expiresAt");

-- 6. Create AuthMailOutbox (durable encrypted transactional email outbox)
CREATE TABLE "AuthMailOutbox" (
  "id" UUID NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "template" "AuthMailTemplate" NOT NULL,
  "encryptedPayload" JSONB,
  "status" "AuthMailOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimUntil" TIMESTAMPTZ(6),
  "sentAt" TIMESTAMPTZ(6),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuthMailOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthMailOutbox_dedupeKey_key" UNIQUE ("dedupeKey"),
  CONSTRAINT "AuthMailOutbox_dedupeKey_len_check" CHECK (char_length("dedupeKey") <= 200),
  CONSTRAINT "AuthMailOutbox_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "AuthMailOutbox_lastErrorCode_len_check" CHECK ("lastErrorCode" IS NULL OR char_length("lastErrorCode") <= 100)
);

CREATE INDEX "AuthMailOutbox_status_nextAttemptAt_idx"
  ON "AuthMailOutbox"("status", "nextAttemptAt");
