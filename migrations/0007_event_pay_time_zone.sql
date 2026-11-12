-- Events: what they pay, and the time zone their start time was entered in.
--
-- "payCents": whole US cents for the whole event, null when the poster did
-- not list pay (applicants then propose a rate, as before).
-- "timeZone": the IANA zone of the poster's browser when the event was
-- posted or rescheduled, e.g. "America/Chicago"; event times are shown in
-- it, labelled. Null for older events, which keep showing in the reader's
-- own zone.
--
-- Numbered 0007: 0006 is taken by a change developed in parallel. Additive
-- only (two nullable columns): safe to apply before the code that uses them
-- is deployed, and in either order with 0006.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "payCents" INTEGER;
ALTER TABLE "Event" ADD COLUMN "timeZone" TEXT;
