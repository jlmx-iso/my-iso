-- Billing state mirrored from Stripe, webhook event de-duplication,
-- per-participant message read state, and index clean-up.
--
-- Safe to apply while the previous release is still serving: it only adds
-- tables, adds columns that are nullable or have a default, and adds or drops
-- indexes. Nothing the previous release reads or writes is removed.

-- ── Subscription: explicit state mirrored from Stripe ───────────────────────
-- (Added with ALTER TABLE rather than Prisma's table rebuild: the rebuild is
-- not needed for nullable/defaulted columns and would rewrite billing rows.)
ALTER TABLE "Subscription" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'incomplete';
ALTER TABLE "Subscription" ADD COLUMN "priceId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "plan" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "interval" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "currentPeriodStart" DATETIME;
ALTER TABLE "Subscription" ADD COLUMN "currentPeriodEnd" DATETIME;
ALTER TABLE "Subscription" ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Subscription" ADD COLUMN "cancelAt" DATETIME;
ALTER TABLE "Subscription" ADD COLUMN "endedAt" DATETIME;
ALTER TABLE "Subscription" ADD COLUMN "cancellationReason" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "stripeCreatedAt" DATETIME;
ALTER TABLE "Subscription" ADD COLUMN "stripeSyncedAt" DATETIME;
-- What entitlements need beyond the status: whether the current period was
-- paid for, since when the subscription has been past due, and an open or
-- lost dispute / a full refund on one of its invoices.
ALTER TABLE "Subscription" ADD COLUMN "latestInvoiceId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "paidThroughAt" DATETIME;
ALTER TABLE "Subscription" ADD COLUMN "pastDueSince" DATETIME;
ALTER TABLE "Subscription" ADD COLUMN "disputeId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "disputeStatus" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "disputeInvoiceId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "refundedInvoiceId" TEXT;

-- Back-fill from the legacy flags, as well as they can express it. Rows that
-- belong to a Stripe subscription are corrected from Stripe by the next
-- webhook event or `subscription.syncStatus` (stripeSyncedAt stays NULL, so
-- any reading from Stripe replaces this guess).
UPDATE "Subscription" SET
  "status" = CASE
    WHEN "isExpired" THEN 'canceled'
    WHEN "isActive" AND "isTrial" THEN 'trialing'
    WHEN "isActive" THEN 'active'
    WHEN "isPaused" THEN 'paused'
    WHEN "isPending" THEN 'incomplete'
    WHEN "isCanceled" THEN 'canceled'
    -- The previous release cleared isActive on the first failed invoice and
    -- never set it back, so such a row may be days or months old. 'unpaid'
    -- keeps it without access, exactly as before, until Stripe is consulted.
    WHEN "subscriptionId" IS NOT NULL THEN 'unpaid'
    ELSE 'incomplete_expired'
  END,
  "currentPeriodEnd" = "expiresAt",
  "cancelAtPeriodEnd" = ("isCanceled" AND "isActive" AND NOT "isExpired"),
  "cancelAt" = CASE WHEN "isCanceled" AND "isActive" AND NOT "isExpired" THEN "expiresAt" END;

UPDATE "Subscription" SET "stripeCustomerId" =
  (SELECT "stripeId" FROM "User" WHERE "User"."id" = "Subscription"."userId");

-- ── Booking: how it was cancelled ───────────────────────────────────────────
-- Existing canceled rows keep NULL (unknown), which never allows re-applying.
ALTER TABLE "Booking" ADD COLUMN "cancelOrigin" TEXT;

-- ── Leases that serialise billing work per user ─────────────────────────────
CREATE TABLE "BillingLease" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "holder" TEXT NOT NULL,
    "expiresAt" INTEGER NOT NULL
);

-- ── Stripe webhook events already taken on ──────────────────────────────────
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "eventCreated" INTEGER NOT NULL,
    "claimedAt" INTEGER NOT NULL,
    "processedAt" INTEGER
);
CREATE INDEX "StripeEvent_claimedAt_idx" ON "StripeEvent"("claimedAt");

-- ── Message read state ──────────────────────────────────────────────────────
CREATE TABLE "ThreadRead" (
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" DATETIME NOT NULL,

    PRIMARY KEY ("threadId", "userId"),
    CONSTRAINT "ThreadRead_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ThreadRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ThreadRead_userId_idx" ON "ThreadRead"("userId");

-- Everything sent before read state existed counts as read; otherwise every
-- conversation would light up as unread on deploy. The timestamp is written
-- in the format Prisma's D1 adapter uses, so it compares correctly with
-- Message.createdAt.
INSERT INTO "ThreadRead" ("threadId", "userId", "lastReadAt")
SELECT "A", "B", strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now') FROM "_MessageThreadToUser";

-- The conversation list sorts by MessageThread.updatedAt. Bump it in the same
-- statement that inserts a message, so a send can never leave the thread in
-- its old position (D1 has no multi-statement transactions).
-- Prisma does not track triggers: see the note on model Message.
CREATE TRIGGER "Message_touch_thread" AFTER INSERT ON "Message"
BEGIN
  UPDATE "MessageThread" SET "updatedAt" = NEW."createdAt" WHERE "id" = NEW."threadId";
END;

DROP INDEX "Message_threadId_idx";
CREATE INDEX "Message_threadId_createdAt_idx" ON "Message"("threadId", "createdAt");

-- ── Indexes for existing query patterns ─────────────────────────────────────
-- A photographer's live events by date (event.getByPhotographerId, profiles).
CREATE INDEX "Event_photographerId_isDeleted_date_idx" ON "Event"("photographerId", "isDeleted", "date");
-- Match expiry sweep (status = 'matched' AND expiresAt < now).
CREATE INDEX "Match_status_expiresAt_idx" ON "Match"("status", "expiresAt");
-- Discover deck and recipient search.
CREATE INDEX "User_isDiscoverable_idx" ON "User"("isDiscoverable");

-- Every read of Event filters on isDeleted, so ("isDeleted", "date") is the
-- index the feeds use; the one on "date" alone is never the better choice.
DROP INDEX "Event_date_idx";
-- Each of these repeats the leading column(s) of a unique index on the same
-- table, which already serves the same lookups.
DROP INDEX "Booking_eventId_idx";
DROP INDEX "InviteCode_code_idx";
DROP INDEX "Swipe_swiperId_idx";
