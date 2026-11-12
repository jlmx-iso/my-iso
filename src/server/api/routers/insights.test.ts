import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { compare, foldSources, getInsights, rangeDays, TOP_EVENTS } from "~/server/_db/insights";
import { utcDay } from "~/server/_lib/viewCounter";
import { createDbCaller } from "~/test/helpers/dbCaller";
import { makePro } from "~/test/helpers/pro";
import { freezeRateLimitClock } from "~/test/helpers/rateLimitClock";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("~/_lib", () => ({ cloudinaryClient: null }));

import { insightsRouter } from "./insights";

freezeRateLimitClock();

type TestUser = { email: string; id: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2030-06-15T15:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);
const TODAY = utcDay(NOW);
const YESTERDAY = utcDay(daysAgo(1));

describe("insights", () => {
  let testDb: TestDb;
  let member: TestUser;
  let other: TestUser;
  let memberProfileId: string;

  const as = (user: TestUser) => createDbCaller(insightsRouter, testDb.db, { user });

  async function views(userId: string, day: string, source: string, count: number) {
    await testDb.db.profileView.create({ data: { count, day, source, userId } });
  }

  async function ownEvent(title: string, options: { isDeleted?: boolean; photographerId?: string } = {}) {
    return testDb.db.event.create({
      data: {
        date: new Date("2031-01-01T12:00:00Z"),
        isDeleted: options.isDeleted ?? false,
        location: "Austin",
        photographerId: options.photographerId ?? memberProfileId,
        title,
      },
    });
  }

  async function application(eventId: string, ownerId: string, createdAt: Date, isDeleted = false) {
    const applicant = await createTestUser(testDb.db);
    await testDb.db.booking.create({ data: { applicantId: applicant.id, createdAt, eventId, isDeleted, ownerId } });
  }

  async function thread(firstSenderId: string, at: Date, options: { replies?: Array<[string, Date]>; firstDeleted?: boolean } = {}) {
    const created = await testDb.db.messageThread.create({
      data: { participants: { connect: [{ id: member.id }, { id: other.id }] } },
    });
    await testDb.db.message.create({
      data: { content: "hi", createdAt: at, isDeleted: options.firstDeleted ?? false, senderId: firstSenderId, threadId: created.id },
    });
    for (const [senderId, createdAt] of options.replies ?? []) {
      await testDb.db.message.create({ data: { content: "re", createdAt, senderId, threadId: created.id } });
    }
  }

  beforeEach(async () => {
    testDb = await createTestDb();
    member = await createTestUser(testDb.db);
    other = await createTestUser(testDb.db);
    memberProfileId = (
      await testDb.db.photographer.create({ data: { companyName: "Studio", location: "Austin", name: "Member", userId: member.id } })
    ).id;
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("is Pro only: FORBIDDEN without an active subscription", async () => {
    await expect(as(member).getSummary({ days: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a range it does not offer", async () => {
    await makePro(testDb.db, member.id);
    await expect(as(member).getSummary({ days: 14 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("answers a Pro member with their own numbers, through yesterday", async () => {
    await makePro(testDb.db, member.id);
    const yesterday = utcDay(new Date(Date.now() - DAY_MS));
    await views(member.id, yesterday, "search", 3);
    await views(member.id, utcDay(new Date()), "search", 9);
    await views(other.id, yesterday, "search", 50);

    const summary = await as(member).getSummary({ days: 7 });

    expect(summary.days).toBe(7);
    expect(summary.to).toBe(yesterday);
    expect(summary.profileViews.value).toBe(3);
  });

  it("is rate limited, so it cannot be polled", async () => {
    await makePro(testDb.db, member.id);
    for (let index = 0; index < 30; index += 1) await as(member).getSummary({ days: 7 });
    await expect(as(member).getSummary({ days: 7 })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("stops answering when the subscription lapses", async () => {
    await makePro(testDb.db, member.id, { cancelAt: new Date(Date.now() - 1000) });
    await expect(as(member).getSummary({ days: 30 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  describe("getInsights", () => {
    it("covers the complete days through yesterday, never today", async () => {
      await views(member.id, TODAY, "search", 50);
      await views(member.id, YESTERDAY, "search", 4);
      await views(member.id, utcDay(daysAgo(7)), "event", 3);
      await views(member.id, utcDay(daysAgo(8)), "search", 100);

      const week = await getInsights(testDb.db, member.id, 7, NOW);

      expect(week.from).toBe("2030-06-08");
      expect(week.to).toBe("2030-06-14");
      expect(week.profileViews.value).toBe(7);
      expect(week.profileViews.daily.map((entry) => entry.day)).toEqual(rangeDays(7, NOW));
      expect(week.profileViews.daily[0]).toEqual({ count: 3, day: "2030-06-08" });
      expect(week.profileViews.daily.at(-1)).toEqual({ count: 4, day: "2030-06-14" });
    });

    it("folds sources with fewer than 3 views into Other", async () => {
      await views(member.id, YESTERDAY, "search", 4);
      await views(member.id, YESTERDAY, "messages", 1);
      await views(member.id, YESTERDAY, "discover", 2);
      await views(member.id, YESTERDAY, "event", 3);
      await views(member.id, YESTERDAY, "something-old", 1);

      const insights = await getInsights(testDb.db, member.id, 7, NOW);

      expect(insights.profileViews.sources).toEqual([
        { count: 4, source: "search" },
        { count: 4, source: "other" },
        { count: 3, source: "event" },
      ]);
    });

    it("compares with the previous period once that period was counted in full", async () => {
      // Counting started 14 days before today: the previous week is complete.
      await views(member.id, utcDay(daysAgo(14)), "search", 10);
      await views(member.id, utcDay(daysAgo(3)), "search", 15);
      const counted = await getInsights(testDb.db, member.id, 7, NOW);
      expect(counted.profileViews).toMatchObject({ changePercent: 50, previous: 10, value: 15 });
      expect(counted.countingSince).toBe(utcDay(daysAgo(14)));

      // The 30-day period before reaches back past the first count: no comparison.
      const month = await getInsights(testDb.db, member.id, 30, NOW);
      expect(month.profileViews).toMatchObject({ changePercent: null, previous: null, value: 25 });
    });

    it("starts the chart on the day counting started", async () => {
      await views(other.id, utcDay(daysAgo(3)), "search", 1);
      const insights = await getInsights(testDb.db, member.id, 30, NOW);
      expect(insights.countingSince).toBe(utcDay(daysAgo(3)));
      expect(insights.profileViews.daily.map((entry) => entry.day)).toEqual([
        utcDay(daysAgo(3)),
        utcDay(daysAgo(2)),
        YESTERDAY,
      ]);
    });

    it("counts views of and applications to the member's own live events, and ranks them", async () => {
      const popular = await ownEvent("Popular");
      const quiet = await ownEvent("Quiet");
      const deleted = await ownEvent("Deleted", { isDeleted: true });
      const otherProfile = await testDb.db.photographer.create({
        data: { companyName: "X", location: "Austin", name: "Other", userId: other.id },
      });
      const theirs = await ownEvent("Theirs", { photographerId: otherProfile.id });

      await testDb.db.eventView.createMany({
        data: [
          { count: 9, day: YESTERDAY, eventId: popular.id },
          { count: 5, day: TODAY, eventId: popular.id },
          { count: 1, day: utcDay(daysAgo(40)), eventId: popular.id },
          { count: 2, day: YESTERDAY, eventId: quiet.id },
          { count: 50, day: YESTERDAY, eventId: deleted.id },
          { count: 70, day: YESTERDAY, eventId: theirs.id },
        ],
      });
      await application(quiet.id, member.id, daysAgo(1));
      await application(quiet.id, member.id, daysAgo(2));
      await application(quiet.id, member.id, daysAgo(3), true);
      await application(quiet.id, member.id, NOW);
      await application(popular.id, member.id, daysAgo(10));
      await application(deleted.id, member.id, daysAgo(1));
      await application(theirs.id, other.id, daysAgo(1));

      const week = await getInsights(testDb.db, member.id, 7, NOW);
      expect(week.eventViews.value).toBe(11);
      expect(week.applications).toMatchObject({ previous: 1, value: 2 });
      expect(week.topEvents).toEqual([
        { applications: 0, date: popular.date, id: popular.id, title: "Popular", views: 9 },
        { applications: 2, date: quiet.date, id: quiet.id, title: "Quiet", views: 2 },
      ]);

      const quarter = await getInsights(testDb.db, member.id, 90, NOW);
      expect(quarter.eventViews.value).toBe(12);
      expect(quarter.applications.value).toBe(3);
    });

    it(`lists at most ${TOP_EVENTS} events`, async () => {
      for (let index = 0; index < TOP_EVENTS + 3; index += 1) {
        const event = await ownEvent(`Event ${index}`);
        await testDb.db.eventView.create({ data: { count: index + 1, day: YESTERDAY, eventId: event.id } });
      }
      const insights = await getInsights(testDb.db, member.id, 7, NOW);
      expect(insights.topEvents).toHaveLength(TOP_EVENTS);
      expect(insights.topEvents[0]?.views).toBe(TOP_EVENTS + 3);
    });

    it("counts conversations others started with the member, by their first message, through yesterday", async () => {
      await thread(other.id, daysAgo(1), { replies: [[member.id, daysAgo(0.5)]] });
      await thread(other.id, daysAgo(3));
      await thread(member.id, daysAgo(1), { replies: [[other.id, daysAgo(0.5)]] });
      await thread(other.id, daysAgo(20));
      await thread(other.id, new Date(NOW.getTime() - 60_000));
      // A first message deleted later still says who started the thread.
      await thread(other.id, daysAgo(2), { firstDeleted: true, replies: [[member.id, daysAgo(1.5)]] });

      expect((await getInsights(testDb.db, member.id, 7, NOW)).conversationsStarted.value).toBe(3);
      expect((await getInsights(testDb.db, member.id, 30, NOW)).conversationsStarted.value).toBe(4);
      expect((await getInsights(testDb.db, other.id, 30, NOW)).conversationsStarted.value).toBe(1);
    });

    it("is all zeros for a member nobody has looked at", async () => {
      const insights = await getInsights(testDb.db, member.id, 90, NOW);
      expect(insights).toMatchObject({
        applications: { value: 0 },
        conversationsStarted: { value: 0 },
        countingSince: null,
        eventViews: { value: 0 },
        profileViews: { previous: null, sources: [], value: 0 },
        topEvents: [],
      });
      expect(insights.profileViews.daily).toHaveLength(90);
    });
  });
});

describe("helpers", () => {
  it("rangeDays lists the complete UTC days ending yesterday, oldest first", () => {
    expect(rangeDays(3, NOW)).toEqual(["2030-06-12", "2030-06-13", "2030-06-14"]);
    expect(rangeDays(2, new Date("2030-03-01T00:30:00.000Z"))).toEqual(["2030-02-27", "2030-02-28"]);
  });

  it("compare gives a whole percent, or nothing to compare with", () => {
    expect(compare(15, 10)).toEqual({ changePercent: 50, previous: 10, value: 15 });
    expect(compare(5, 10)).toEqual({ changePercent: -50, previous: 10, value: 5 });
    expect(compare(5, 0)).toEqual({ changePercent: null, previous: 0, value: 5 });
    expect(compare(5, null)).toEqual({ changePercent: null, previous: null, value: 5 });
  });

  it("foldSources keeps Other last among equals and drops empty sources", () => {
    expect(foldSources(new Map())).toEqual([]);
    expect(foldSources(new Map([["direct", 2]]))).toEqual([{ count: 2, source: "other" }]);
  });
});
