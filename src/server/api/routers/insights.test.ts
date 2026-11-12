import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getInsights, rangeDays, TOP_EVENTS } from "~/server/_db/insights";
import { utcDay } from "~/server/_lib/viewCounter";
import { createDbCaller } from "~/test/helpers/dbCaller";
import { makePro } from "~/test/helpers/pro";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("~/_lib", () => ({ cloudinaryClient: null }));

import { insightsRouter } from "./insights";

type TestUser = { email: string; id: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2030-06-15T15:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

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

  async function thread(firstSenderId: string, at: Date, replies: Array<[string, Date]> = []) {
    const created = await testDb.db.messageThread.create({
      data: { participants: { connect: [{ id: member.id }, { id: other.id }] } },
    });
    await testDb.db.message.create({ data: { content: "hi", createdAt: at, senderId: firstSenderId, threadId: created.id } });
    for (const [senderId, createdAt] of replies) {
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

  it("answers a Pro member with their own numbers", async () => {
    await makePro(testDb.db, member.id);
    await views(member.id, utcDay(new Date()), "search", 3);
    await views(other.id, utcDay(new Date()), "search", 50);

    const summary = await as(member).getSummary({ days: 7 });

    expect(summary.days).toBe(7);
    expect(summary.profileViews.total).toBe(3);
    expect(summary.profileViews.daily).toHaveLength(7);
  });

  it("stops answering when the subscription lapses", async () => {
    await makePro(testDb.db, member.id, { cancelAt: new Date(Date.now() - 1000) });
    await expect(as(member).getSummary({ days: 30 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  describe("getInsights", () => {
    it("adds up profile views per day and per source within the range only", async () => {
      await views(member.id, utcDay(NOW), "search", 4);
      await views(member.id, utcDay(NOW), "direct", 1);
      await views(member.id, utcDay(daysAgo(6)), "event", 2);
      await views(member.id, utcDay(daysAgo(7)), "search", 100);
      await views(member.id, utcDay(NOW), "something-old", 1);

      const insights = await getInsights(testDb.db, member.id, 7, NOW);

      expect(insights.from).toBe("2030-06-09");
      expect(insights.to).toBe("2030-06-15");
      expect(insights.profileViews.total).toBe(8);
      expect(insights.profileViews.daily[0]).toEqual({ count: 2, day: "2030-06-09" });
      expect(insights.profileViews.daily.at(-1)).toEqual({ count: 6, day: "2030-06-15" });
      expect(insights.profileViews.daily.slice(1, -1).every((entry) => entry.count === 0)).toBe(true);
      expect(insights.profileViews.sources).toEqual([
        { count: 4, source: "search" },
        { count: 2, source: "event" },
        { count: 1, source: "direct" },
        { count: 1, source: "other" },
      ]);

      const longer = await getInsights(testDb.db, member.id, 30, NOW);
      expect(longer.profileViews.total).toBe(108);
      expect(longer.profileViews.daily).toHaveLength(30);
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
          { count: 9, day: utcDay(NOW), eventId: popular.id },
          { count: 1, day: utcDay(daysAgo(40)), eventId: popular.id },
          { count: 2, day: utcDay(NOW), eventId: quiet.id },
          { count: 50, day: utcDay(NOW), eventId: deleted.id },
          { count: 70, day: utcDay(NOW), eventId: theirs.id },
        ],
      });
      await application(quiet.id, member.id, daysAgo(1));
      await application(quiet.id, member.id, daysAgo(2));
      await application(quiet.id, member.id, daysAgo(3), true);
      await application(popular.id, member.id, daysAgo(10));
      await application(deleted.id, member.id, daysAgo(1));
      await application(theirs.id, other.id, daysAgo(1));

      const week = await getInsights(testDb.db, member.id, 7, NOW);
      expect(week.eventViews).toBe(11);
      expect(week.applications).toBe(2);
      expect(week.topEvents).toEqual([
        { applications: 0, date: popular.date, id: popular.id, title: "Popular", views: 9 },
        { applications: 2, date: quiet.date, id: quiet.id, title: "Quiet", views: 2 },
      ]);

      const quarter = await getInsights(testDb.db, member.id, 90, NOW);
      expect(quarter.eventViews).toBe(12);
      expect(quarter.applications).toBe(3);
    });

    it(`lists at most ${TOP_EVENTS} events`, async () => {
      for (let index = 0; index < TOP_EVENTS + 3; index += 1) {
        const event = await ownEvent(`Event ${index}`);
        await testDb.db.eventView.create({ data: { count: index + 1, day: utcDay(NOW), eventId: event.id } });
      }
      const insights = await getInsights(testDb.db, member.id, 7, NOW);
      expect(insights.topEvents).toHaveLength(TOP_EVENTS);
      expect(insights.topEvents[0]?.views).toBe(TOP_EVENTS + 3);
    });

    it("counts conversations others started with the member, by their first message", async () => {
      await thread(other.id, daysAgo(1), [[member.id, daysAgo(0.5)]]);
      await thread(other.id, daysAgo(3));
      await thread(member.id, daysAgo(1), [[other.id, daysAgo(0.5)]]);
      await thread(other.id, daysAgo(20));

      expect((await getInsights(testDb.db, member.id, 7, NOW)).conversationsStarted).toBe(2);
      expect((await getInsights(testDb.db, member.id, 30, NOW)).conversationsStarted).toBe(3);
      expect((await getInsights(testDb.db, other.id, 30, NOW)).conversationsStarted).toBe(1);
    });

    it("is all zeros for a member nobody has looked at", async () => {
      const insights = await getInsights(testDb.db, member.id, 90, NOW);
      expect(insights).toMatchObject({
        applications: 0,
        conversationsStarted: 0,
        eventViews: 0,
        profileViews: { sources: [], total: 0 },
        topEvents: [],
      });
      expect(insights.profileViews.daily).toHaveLength(90);
    });
  });
});

describe("rangeDays", () => {
  it("lists the UTC days ending today, oldest first", () => {
    expect(rangeDays(3, NOW)).toEqual(["2030-06-13", "2030-06-14", "2030-06-15"]);
    expect(rangeDays(2, new Date("2030-03-01T00:30:00.000Z"))).toEqual(["2030-02-28", "2030-03-01"]);
  });
});
