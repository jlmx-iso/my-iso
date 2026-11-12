-- Icebreakers are generated once per match and stored (Match.icebreakers,
-- a JSON array of strings); icebreakersRequestedAt bounds retries.
--
-- InviteCode.slotsChangedAt lets the reconcile job look only at codes whose
-- slots were claimed or released recently. InviteCode.redeemedCount is what
-- it reconciles against: the number of redemptions ever recorded, which a
-- trigger raises together with each redemption and nothing lowers, so a used
-- invite stays used after the invited member's account is deleted.
--
-- Additive only (nullable columns, a column with a default, an index, a
-- trigger): safe to apply before the code that uses it is deployed.

-- AlterTable
ALTER TABLE "InviteCode" ADD COLUMN "slotsChangedAt" DATETIME;
ALTER TABLE "InviteCode" ADD COLUMN "redeemedCount" INTEGER NOT NULL DEFAULT 0;

-- Existing codes: every slot counted so far is taken to be a real redemption
-- (the counter may include a leaked slot; being wrong in that direction costs
-- an inviter one invite, never admits anyone).
UPDATE "InviteCode"
SET "redeemedCount" = MAX(
  "currentRedemptions",
  (SELECT COUNT(*) FROM "InviteRedemption" WHERE "inviteCodeId" = "InviteCode"."id")
);

-- Not managed by Prisma (it has no notion of triggers); `npm run db:check`
-- ignores it and the tests run with it, because they build from this file.
CREATE TRIGGER "InviteRedemption_count"
AFTER INSERT ON "InviteRedemption"
BEGIN
  UPDATE "InviteCode"
  SET "redeemedCount" = "redeemedCount" + 1
  WHERE "id" = NEW."inviteCodeId";
END;

-- AlterTable
ALTER TABLE "Match" ADD COLUMN "icebreakers" TEXT;
ALTER TABLE "Match" ADD COLUMN "icebreakersRequestedAt" DATETIME;

-- CreateIndex
CREATE INDEX "InviteCode_slotsChangedAt_idx" ON "InviteCode"("slotsChangedAt");

-- "Match_status_expiresAt_idx" (declared in the Prisma schema, used by the
-- expiry job) is created by 0003_billing_read_state_indexes.sql.
