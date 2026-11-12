-- Account deletion (src/server/_lib/account/deletion.ts, docs/DATABASE.md
-- "Account deletion"). Additive: nullable or defaulted columns on User, one
-- on Photographer, and an index. ADD COLUMN instead of the table rebuild
-- `prisma migrate diff` proposes, which would drop and recreate User (and
-- with it, through ON DELETE CASCADE, everything that points at it) for no
-- gain.
--
-- Numbered 0006: 0005 is taken by the Pro insights change.

ALTER TABLE "User" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "deletionRequestedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "deletedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "deletionAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "deletionAttemptedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "deletionSkipped" TEXT;
CREATE INDEX "User_isDeleted_deletedAt_deletionAttemptedAt_idx" ON "User"("isDeleted", "deletedAt", "deletionAttemptedAt");

ALTER TABLE "Photographer" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- Google sign-in no longer keeps OAuth tokens (src/auth.ts, linkAccount):
-- nothing calls Google on a member's behalf. Clear the ones stored before.
UPDATE "Account"
SET "access_token" = NULL, "refresh_token" = NULL, "id_token" = NULL, "session_state" = NULL,
    "expires_at" = NULL, "scope" = NULL, "token_type" = NULL;
