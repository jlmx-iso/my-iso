-- Icebreakers are generated once per match and stored (Match.icebreakers,
-- a JSON array of strings); icebreakersRequestedAt bounds retries.
-- InviteCode.slotsChangedAt lets the reconcile job look only at codes whose
-- slots were claimed or released recently.
--
-- Additive only (nullable columns, indexes): safe to apply before the code
-- that uses it is deployed.

-- AlterTable
ALTER TABLE "InviteCode" ADD COLUMN "slotsChangedAt" DATETIME;

-- AlterTable
ALTER TABLE "Match" ADD COLUMN "icebreakers" TEXT;
ALTER TABLE "Match" ADD COLUMN "icebreakersRequestedAt" DATETIME;

-- CreateIndex
CREATE INDEX "InviteCode_slotsChangedAt_idx" ON "InviteCode"("slotsChangedAt");

-- CreateIndex
CREATE INDEX "Match_status_expiresAt_idx" ON "Match"("status", "expiresAt");

