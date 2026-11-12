-- Pro insights: daily view counters for profiles and events.
--
-- One row per (profile owner, UTC day, source) and per (event, UTC day),
-- each holding a count that src/server/_lib/viewCounter.ts raises with a
-- single atomic upsert (INSERT ... ON CONFLICT DO UPDATE SET count = count + 1).
-- No viewer is ever stored: these tables cannot say who looked, only how
-- often and (for profiles) from which part of the app.
--
-- Pro status itself needs no column: search ranks with the entitlement rule
-- expressed in SQL against "Subscription" at read time
-- (src/server/_billing/proStatus.ts), so a lapsed subscription stops ranking
-- the moment its access ends.
--
-- Additive only (two new tables and their indexes): safe to apply before the code that uses
-- them is deployed.

-- CreateTable
CREATE TABLE "ProfileView" (
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("userId", "day", "source"),
    CONSTRAINT "ProfileView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventView" (
    "eventId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("eventId", "day"),
    CONSTRAINT "EventView_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProfileView_day_idx" ON "ProfileView"("day");

-- CreateIndex
CREATE INDEX "EventView_day_idx" ON "EventView"("day");
