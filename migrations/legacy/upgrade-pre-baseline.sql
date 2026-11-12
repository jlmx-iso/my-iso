-- Brings a D1 database created BEFORE the migration baseline to exactly the
-- schema of migrations/0001_init.sql, and records 0001_init.sql as applied.
--
-- For the two databases created from main at 2d1d630 (staging and
-- production): their schema is migrations/legacy/pre-baseline-schema.sql.
-- Run it only through `npm run db:upgrade-legacy -- --env <name>`, which
-- checks that the database has exactly that schema first, takes a backup,
-- and verifies the result (scripts/db-upgrade-legacy.mjs). Never applied by
-- `wrangler d1 migrations apply`: that only reads migrations/*.sql, not
-- subdirectories. src/server/_db/legacyUpgrade.test.ts runs it against a
-- copy of the pre-baseline schema with the old staging seed.
--
-- The script runs it only on a database whose schema is exactly the expected
-- one, so no statement should fail; if one does, compare with the backup it
-- took before going on. No table is rebuilt (a DROP TABLE on "User" would cascade-delete
-- every row that references it); columns are added with ALTER TABLE, which
-- yields the same schema as the baseline because the baseline added them
-- last as well.

-- 1. Timestamps: one spelling (docs/DATABASE.md, "Timestamps are text").
--    Text written as ...Z, or in SQLite's CURRENT_TIMESTAMP form, becomes
--    Prisma's ...+00:00 form, so comparisons and ORDER BY agree with time.
--    The old staging seed wrote ...Z. Rows already in the right form, and
--    non-text values, are not touched. First, so that the de-duplication
--    below orders by time.
UPDATE "Booking" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt")
  WHERE typeof("createdAt") = 'text' AND "createdAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt") IS NOT NULL;
UPDATE "Booking" SET "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt")
  WHERE typeof("updatedAt") = 'text' AND "updatedAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt") IS NOT NULL;
UPDATE "Comment" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt")
  WHERE typeof("createdAt") = 'text' AND "createdAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt") IS NOT NULL;
UPDATE "Comment" SET "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt")
  WHERE typeof("updatedAt") = 'text' AND "updatedAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt") IS NOT NULL;
UPDATE "CommentLike" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt")
  WHERE typeof("createdAt") = 'text' AND "createdAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt") IS NOT NULL;
UPDATE "CommentLike" SET "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt")
  WHERE typeof("updatedAt") = 'text' AND "updatedAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt") IS NOT NULL;
UPDATE "Event" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt")
  WHERE typeof("createdAt") = 'text' AND "createdAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt") IS NOT NULL;
UPDATE "Event" SET "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt")
  WHERE typeof("updatedAt") = 'text' AND "updatedAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt") IS NOT NULL;
UPDATE "Event" SET "date" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "date")
  WHERE typeof("date") = 'text' AND "date" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "date") IS NOT NULL;
UPDATE "EventLike" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt")
  WHERE typeof("createdAt") = 'text' AND "createdAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt") IS NOT NULL;
UPDATE "EventLike" SET "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt")
  WHERE typeof("updatedAt") = 'text' AND "updatedAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt") IS NOT NULL;
UPDATE "Example" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt")
  WHERE typeof("createdAt") = 'text' AND "createdAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt") IS NOT NULL;
UPDATE "Example" SET "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt")
  WHERE typeof("updatedAt") = 'text' AND "updatedAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt") IS NOT NULL;
UPDATE "Favorite" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt")
  WHERE typeof("createdAt") = 'text' AND "createdAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt") IS NOT NULL;
UPDATE "Favorite" SET "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt")
  WHERE typeof("updatedAt") = 'text' AND "updatedAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt") IS NOT NULL;
UPDATE "InviteCode" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt")
  WHERE typeof("createdAt") = 'text' AND "createdAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt") IS NOT NULL;
UPDATE "InviteCode" SET "regeneratedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "regeneratedAt")
  WHERE typeof("regeneratedAt") = 'text' AND "regeneratedAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "regeneratedAt") IS NOT NULL;
UPDATE "InviteRedemption" SET "redeemedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "redeemedAt")
  WHERE typeof("redeemedAt") = 'text' AND "redeemedAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "redeemedAt") IS NOT NULL;
UPDATE "Match" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt")
  WHERE typeof("createdAt") = 'text' AND "createdAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt") IS NOT NULL;
UPDATE "Match" SET "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt")
  WHERE typeof("updatedAt") = 'text' AND "updatedAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt") IS NOT NULL;
UPDATE "Match" SET "expiresAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "expiresAt")
  WHERE typeof("expiresAt") = 'text' AND "expiresAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "expiresAt") IS NOT NULL;
UPDATE "Message" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt")
  WHERE typeof("createdAt") = 'text' AND "createdAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt") IS NOT NULL;
UPDATE "Message" SET "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt")
  WHERE typeof("updatedAt") = 'text' AND "updatedAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt") IS NOT NULL;
UPDATE "MessageThread" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt")
  WHERE typeof("createdAt") = 'text' AND "createdAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt") IS NOT NULL;
UPDATE "MessageThread" SET "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt")
  WHERE typeof("updatedAt") = 'text' AND "updatedAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt") IS NOT NULL;
UPDATE "Notification" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt")
  WHERE typeof("createdAt") = 'text' AND "createdAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt") IS NOT NULL;
UPDATE "PendingInviteValidation" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt")
  WHERE typeof("createdAt") = 'text' AND "createdAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt") IS NOT NULL;
UPDATE "PendingInviteValidation" SET "expiresAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "expiresAt")
  WHERE typeof("expiresAt") = 'text' AND "expiresAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "expiresAt") IS NOT NULL;
UPDATE "Photographer" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt")
  WHERE typeof("createdAt") = 'text' AND "createdAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt") IS NOT NULL;
UPDATE "Photographer" SET "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt")
  WHERE typeof("updatedAt") = 'text' AND "updatedAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt") IS NOT NULL;
UPDATE "PortfolioImage" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt")
  WHERE typeof("createdAt") = 'text' AND "createdAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt") IS NOT NULL;
UPDATE "PortfolioImage" SET "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt")
  WHERE typeof("updatedAt") = 'text' AND "updatedAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt") IS NOT NULL;
UPDATE "Review" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt")
  WHERE typeof("createdAt") = 'text' AND "createdAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt") IS NOT NULL;
UPDATE "Review" SET "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt")
  WHERE typeof("updatedAt") = 'text' AND "updatedAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt") IS NOT NULL;
UPDATE "Session" SET "expires" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "expires")
  WHERE typeof("expires") = 'text' AND "expires" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "expires") IS NOT NULL;
UPDATE "Subscription" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt")
  WHERE typeof("createdAt") = 'text' AND "createdAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt") IS NOT NULL;
UPDATE "Subscription" SET "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt")
  WHERE typeof("updatedAt") = 'text' AND "updatedAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt") IS NOT NULL;
UPDATE "Subscription" SET "expiresAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "expiresAt")
  WHERE typeof("expiresAt") = 'text' AND "expiresAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "expiresAt") IS NOT NULL;
UPDATE "Swipe" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt")
  WHERE typeof("createdAt") = 'text' AND "createdAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt") IS NOT NULL;
UPDATE "User" SET "emailVerified" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "emailVerified")
  WHERE typeof("emailVerified") = 'text' AND "emailVerified" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "emailVerified") IS NOT NULL;
UPDATE "User" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt")
  WHERE typeof("createdAt") = 'text' AND "createdAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt") IS NOT NULL;
UPDATE "User" SET "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt")
  WHERE typeof("updatedAt") = 'text' AND "updatedAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "updatedAt") IS NOT NULL;
UPDATE "Waitlist" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt")
  WHERE typeof("createdAt") = 'text' AND "createdAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "createdAt") IS NOT NULL;
UPDATE "Waitlist" SET "reviewedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "reviewedAt")
  WHERE typeof("reviewedAt") = 'text' AND "reviewedAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "reviewedAt") IS NOT NULL;
UPDATE "Waitlist" SET "convertedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', "convertedAt")
  WHERE typeof("convertedAt") = 'text' AND "convertedAt" NOT LIKE '%+00:00' AND strftime('%Y-%m-%dT%H:%M:%f+00:00', "convertedAt") IS NOT NULL;

-- 2. De-duplicate, so the new unique indexes can be created.

-- One like per (event, user): keep a live one if there is one, else the oldest.
DELETE FROM "EventLike" WHERE "id" NOT IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (
      PARTITION BY "eventId", "userId" ORDER BY "isDeleted" ASC, "createdAt" ASC, "id" ASC
    ) AS "position" FROM "EventLike"
  ) WHERE "position" = 1
);

-- One like per (comment, user): same rule.
DELETE FROM "CommentLike" WHERE "id" NOT IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (
      PARTITION BY "commentId", "userId" ORDER BY "isDeleted" ASC, "createdAt" ASC, "id" ASC
    ) AS "position" FROM "CommentLike"
  ) WHERE "position" = 1
);

-- One review per (photographer, reviewer): keep the most recently edited.
DELETE FROM "Review" WHERE "id" NOT IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (
      PARTITION BY "photographerId", "userId" ORDER BY "updatedAt" DESC, "id" DESC
    ) AS "position" FROM "Review"
  ) WHERE "position" = 1
);

-- One invite redemption per user: keep the first. InviteCode.currentRedemptions
-- is not adjusted (migration 0004 and the reconcile job take care of counts).
DELETE FROM "InviteRedemption" WHERE "id" NOT IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (
      PARTITION BY "redeemedById" ORDER BY "redeemedAt" ASC, "id" ASC
    ) AS "position" FROM "InviteRedemption"
  ) WHERE "position" = 1
);

-- 3. Sign-in codes: a 6-digit code is unique per address, not globally.
--    Pending codes are short-lived; they are discarded.
DROP INDEX "VerificationToken_token_key";
DELETE FROM "VerificationToken";
ALTER TABLE "VerificationToken" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "VerificationToken_expires_idx" ON "VerificationToken"("expires");

-- 4. The rest of the difference to the baseline.
DROP INDEX "InviteRedemption_redeemedById_idx";
DROP INDEX "InviteRedemption_inviteCodeId_redeemedById_key";
CREATE UNIQUE INDEX "InviteRedemption_redeemedById_key" ON "InviteRedemption"("redeemedById");
CREATE INDEX "InviteRedemption_inviteCodeId_idx" ON "InviteRedemption"("inviteCodeId");

CREATE UNIQUE INDEX "EventLike_eventId_userId_key" ON "EventLike"("eventId", "userId");
CREATE UNIQUE INDEX "CommentLike_commentId_userId_key" ON "CommentLike"("commentId", "userId");
CREATE UNIQUE INDEX "Review_photographerId_userId_key" ON "Review"("photographerId", "userId");

ALTER TABLE "MessageThread" ADD COLUMN "participantKey" TEXT;
CREATE UNIQUE INDEX "MessageThread_participantKey_key" ON "MessageThread"("participantKey");

CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "windowStart" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" INTEGER NOT NULL,

    PRIMARY KEY ("key", "windowStart")
);
CREATE INDEX "RateLimit_expiresAt_idx" ON "RateLimit"("expiresAt");

-- 5. Record the baseline as applied, in the table and the form wrangler
--    (4.x) itself uses, so `wrangler d1 migrations apply` starts at 0003.
CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" (name)
values ('0001_init.sql');
