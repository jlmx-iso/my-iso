import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_LIST_OFFSET } from "~/server/_db/pagination";
import { RateLimits } from "~/server/_utils/rateLimit";
import { createDbCaller } from "~/test/helpers/dbCaller";
import { freezeRateLimitClock } from "~/test/helpers/rateLimitClock";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

// ---------------------------------------------------------------------------
// Capped lists (newest items win, cursors), rows that belong to deleted
// events, and application rules, against a real SQLite database.
// ---------------------------------------------------------------------------

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));

import { bookingRouter } from "./booking";
import { discoverRouter } from "./discover";
import { eventRouter, MAX_COMMENTS_PAGE_SIZE } from "./event";
import { notificationRouter } from "./notification";
import { reviewRouter } from "./review";
import { userRouter } from "./user";

type TestUser = { email: string; id: string };

const DAY_MS = 24 * 60 * 60 * 1000;

freezeRateLimitClock();

describe("lists against SQLite", () => {
  let testDb: TestDb;
  let owner: TestUser;
  let visitor: TestUser;
  let photographerId: string;

  const eventsAs = (user: TestUser) => createDbCaller(eventRouter, testDb.db, { user });
  const bookingsAs = (user: TestUser) => createDbCaller(bookingRouter, testDb.db, { user });
  const reviewsAs = (user?: TestUser) => createDbCaller(reviewRouter, testDb.db, { user });
  const usersAs = (user?: TestUser) => createDbCaller(userRouter, testDb.db, { user });

  /** A minute-by-minute timeline in the past, so that creation order is unambiguous. */
  const minute = (n: number) => new Date(Date.UTC(2020, 0, 1, 0, n));

  async function createEvent(overrides: { date?: Date; isDeleted?: boolean; title?: string } = {}) {
    return testDb.db.event.create({
      data: {
        date: new Date(Date.now() + 30 * DAY_MS),
        location: "Austin, TX",
        photographerId,
        title: "Wedding",
        ...overrides,
      },
    });
  }

  async function createComments(eventId: string, count: number) {
    await testDb.db.comment.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        content: `comment ${i}`,
        createdAt: minute(i),
        eventId,
        userId: visitor.id,
      })),
    });
  }

  /** Follows `nextCursor` to the end and returns every page. */
  async function allPages<T>(
    load: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
  ): Promise<T[][]> {
    const pages: T[][] = [];
    let cursor: string | undefined;
    do {
      const page = await load(cursor);
      pages.push(page.items);
      cursor = page.nextCursor ?? undefined;
      expect(pages.length).toBeLessThan(50);
    } while (cursor);
    return pages;
  }

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    const { raw } = testDb;
    await raw.rateLimit.deleteMany();
    await raw.notification.deleteMany();
    await raw.match.deleteMany();
    await raw.favorite.deleteMany();
    await raw.review.deleteMany();
    await raw.booking.deleteMany();
    await raw.commentLike.deleteMany();
    await raw.comment.deleteMany();
    await raw.event.deleteMany();
    await raw.photographer.deleteMany();
    await raw.user.deleteMany();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    owner = await createTestUser(testDb.db, { firstName: "Olive" });
    visitor = await createTestUser(testDb.db, { firstName: "Vic" });
    photographerId = (
      await testDb.db.photographer.create({
        data: { companyName: "Olive Photo", location: "Austin, TX", name: "Olive", userId: owner.id },
      })
    ).id;
  });

  // -------------------------------------------------------------------------
  describe("event comments", () => {
    it("returns the NEWEST comments when there are more than the cap, in display order", async () => {
      const event = await createEvent();
      const total = MAX_COMMENTS_PAGE_SIZE + 20;
      await createComments(event.id, total);

      const comments = await eventsAs(visitor).getCommentsByEventId({ eventId: event.id });

      expect(comments).toHaveLength(MAX_COMMENTS_PAGE_SIZE);
      // Oldest of the newest slice first, the very latest comment last.
      expect(comments[0]?.content).toBe("comment 20");
      expect(comments.at(-1)?.content).toBe(`comment ${total - 1}`);
    });

    it("shows a comment posted just now on a long discussion", async () => {
      const event = await createEvent();
      await createComments(event.id, MAX_COMMENTS_PAGE_SIZE + 5);

      await eventsAs(visitor).addCommentToEvent({ content: "the latest", eventId: event.id });

      const comments = await eventsAs(visitor).getCommentsByEventId({ eventId: event.id });
      expect(comments.at(-1)?.content).toBe("the latest");
    });

    it("loads older comments with the cursor", async () => {
      const event = await createEvent();
      await createComments(event.id, 7);
      const events = eventsAs(visitor);

      const newest = await events.getCommentsByEventId({ eventId: event.id, limit: 3 });
      const older = await events.getCommentsByEventId({
        cursor: newest[0]?.id,
        eventId: event.id,
        limit: 3,
      });

      expect(newest.map((c) => c.content)).toEqual(["comment 4", "comment 5", "comment 6"]);
      expect(older.map((c) => c.content)).toEqual(["comment 1", "comment 2", "comment 3"]);
    });

    it("getCommentsPage walks back to the first comment and then stops", async () => {
      const event = await createEvent();
      await createComments(event.id, 7);

      const pages = await allPages((cursor) =>
        eventsAs(visitor).getCommentsPage({ cursor, eventId: event.id, limit: 3 }),
      );

      expect(pages.map((page) => page.map((c) => c.content))).toEqual([
        ["comment 4", "comment 5", "comment 6"],
        ["comment 1", "comment 2", "comment 3"],
        ["comment 0"],
      ]);
      await expect(
        eventsAs(visitor).getCommentsPage({ eventId: event.id, limit: 7 }),
      ).resolves.toMatchObject({ nextCursor: null });
    });

    it("keeps like state and counts on paged comments", async () => {
      const event = await createEvent();
      await createComments(event.id, 2);
      const [first] = await testDb.db.comment.findMany({ orderBy: { createdAt: "asc" } });
      await eventsAs(visitor).addOrRemoveEventCommentLike({ targetId: first?.id ?? "" });

      const { items } = await eventsAs(visitor).getCommentsPage({ eventId: event.id });

      expect(items.map((c) => ({ isLiked: c.isLiked, likes: c.commentLikes }))).toEqual([
        { isLiked: true, likes: 1 },
        { isLiked: false, likes: 0 },
      ]);
    });

    it("reports the viewer's likes across a full page, ignoring removed likes and other people's", async () => {
      const event = await createEvent();
      await createComments(event.id, MAX_COMMENTS_PAGE_SIZE);
      const all = await testDb.db.comment.findMany({ orderBy: { createdAt: "asc" } });
      const id = (index: number) => all[index]?.id ?? "";
      // The viewer likes the oldest, a middle and the newest comment, and has
      // un-liked another; the owner likes a fourth.
      await testDb.db.commentLike.createMany({
        data: [
          { commentId: id(0), userId: visitor.id },
          { commentId: id(55), userId: visitor.id },
          { commentId: id(MAX_COMMENTS_PAGE_SIZE - 1), userId: visitor.id },
          { commentId: id(10), isDeleted: true, userId: visitor.id },
          { commentId: id(20), userId: owner.id },
          { commentId: id(55), userId: owner.id },
        ],
      });

      const comments = await eventsAs(visitor).getCommentsByEventId({ eventId: event.id });

      expect(comments).toHaveLength(MAX_COMMENTS_PAGE_SIZE);
      expect(comments.flatMap((c, index) => (c.isLiked ? [index] : []))).toEqual([
        0,
        55,
        MAX_COMMENTS_PAGE_SIZE - 1,
      ]);
      expect(comments[55]?.commentLikes).toBe(2);
      expect(comments[10]?.commentLikes).toBe(0);
      expect(comments[20]).toMatchObject({ commentLikes: 1, isLiked: false });
      await expect(eventsAs(visitor).getCommentById({ id: id(55) })).resolves.toMatchObject({
        commentLikes: 2,
        isLiked: true,
      });
    });

    it("hides the comments of a deleted event everywhere", async () => {
      const event = await createEvent();
      await createComments(event.id, 3);
      const [comment] = await testDb.db.comment.findMany();
      const commentId = comment?.id ?? "";
      await testDb.raw.event.update({ data: { isDeleted: true }, where: { id: event.id } });
      const events = eventsAs(visitor);

      await expect(events.getCommentsByEventId({ eventId: event.id })).resolves.toEqual([]);
      await expect(events.getCommentsPage({ eventId: event.id })).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
      await expect(events.getCommentCountByEventId({ eventId: event.id })).resolves.toBe(0);
      await expect(events.getCommentById({ id: commentId })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(
        events.addOrRemoveEventCommentLike({ targetId: commentId }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(testDb.raw.commentLike.count()).resolves.toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("bookings", () => {
    async function apply(count: number) {
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        const event = await createEvent({ title: `Event ${i}` });
        const booking = await testDb.db.booking.create({
          data: { applicantId: visitor.id, createdAt: minute(i), eventId: event.id, ownerId: owner.id },
        });
        ids.push(booking.id);
      }
      return ids;
    }

    it("lists applications newest first, on both sides, with cursors", async () => {
      const newestFirst = (await apply(5)).reverse();

      const mine = await bookingsAs(visitor).getMyApplications({ limit: 2 });
      const received = await bookingsAs(owner).getReceivedApplications({ limit: 2 });
      expect(mine.map((b) => b.id)).toEqual(newestFirst.slice(0, 2));
      expect(received.map((b) => b.id)).toEqual(newestFirst.slice(0, 2));

      const minePages = await allPages((cursor) =>
        bookingsAs(visitor).getMyApplicationsPage({ cursor, limit: 2 }),
      );
      const receivedPages = await allPages((cursor) =>
        bookingsAs(owner).getReceivedApplicationsPage({ cursor, limit: 2 }),
      );
      expect(minePages.map((page) => page.length)).toEqual([2, 2, 1]);
      expect(minePages.flat().map((b) => b.id)).toEqual(newestFirst);
      expect(receivedPages.flat().map((b) => b.id)).toEqual(newestFirst);
      // Each side sees the other party, as before.
      expect(minePages[0]?.[0]).toMatchObject({ event: { title: "Event 4" }, owner: { id: owner.id } });
      expect(receivedPages[0]?.[0]).toMatchObject({ applicant: { id: visitor.id } });
    });

    it("does not hand out a deleted event through a booking", async () => {
      const [, second] = await apply(2);
      const kept = await testDb.db.booking.findUniqueOrThrow({ where: { id: second ?? "" } });
      await testDb.raw.event.updateMany({
        data: { isDeleted: true, title: "Secret shoot" },
        where: { id: { not: kept.eventId } },
      });

      const lists = [
        await bookingsAs(visitor).getMyApplications(),
        await bookingsAs(owner).getReceivedApplications(),
        (await bookingsAs(visitor).getMyApplicationsPage()).items,
        (await bookingsAs(owner).getReceivedApplicationsPage()).items,
      ];

      for (const list of lists) {
        expect(list.map((b) => b.id)).toEqual([kept.id]);
        expect(JSON.stringify(list)).not.toContain("Secret shoot");
      }
    });

    it("refuses an application to an event that has already taken place", async () => {
      const past = await createEvent({ date: new Date(Date.now() - 60_000) });
      const upcoming = await createEvent({ date: new Date(Date.now() + 60 * 60_000) });

      await expect(
        bookingsAs(visitor).applyToEvent({ eventId: past.id }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(testDb.raw.booking.count()).resolves.toBe(0);
      await expect(
        bookingsAs(visitor).applyToEvent({ eventId: upcoming.id }),
      ).resolves.toMatchObject({ status: "applied" });
    });

    it("refuses an application to a deleted event", async () => {
      const deleted = await createEvent({ isDeleted: true });
      await expect(
        bookingsAs(visitor).applyToEvent({ eventId: deleted.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("rate limits applications per user", async () => {
      const event = await createEvent();
      const limit = RateLimits.BOOKING_APPLY.limit;
      // The first succeeds, the rest are conflicts: every call is counted.
      for (let i = 0; i < limit; i++) {
        await bookingsAs(visitor)
          .applyToEvent({ eventId: event.id })
          .catch(() => undefined);
      }

      await expect(
        bookingsAs(visitor).applyToEvent({ eventId: event.id }),
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
      // Someone else is not affected.
      const other = await createTestUser(testDb.db);
      await expect(bookingsAs(other).applyToEvent({ eventId: event.id })).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  describe("reviews", () => {
    it("returns the newest reviews first and pages with nextCursor, without a session", async () => {
      const titles: string[] = [];
      for (let i = 0; i < 5; i++) {
        const reviewer = await createTestUser(testDb.db);
        await testDb.db.review.create({
          data: { createdAt: minute(i), photographerId, rating: 5, title: `Review ${i}`, userId: reviewer.id },
        });
        titles.unshift(`Review ${i}`);
      }

      const capped = await reviewsAs().getByPhotographerId({ limit: 2, photographerId });
      expect(capped.map((r) => r.title)).toEqual(titles.slice(0, 2));

      const pages = await allPages((cursor) =>
        reviewsAs().getPageByPhotographerId({ cursor, limit: 2, photographerId }),
      );
      expect(pages.map((page) => page.length)).toEqual([2, 2, 1]);
      expect(pages.flat().map((r) => r.title)).toEqual(titles);
      // Still no reviewer ids or emails in the public output.
      expect(Object.keys(pages[0]?.[0]?.user ?? {}).sort()).toEqual([
        "firstName",
        "lastName",
        "profilePic",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  describe("user.isHandleAvailable", () => {
    it("says whether the caller could take a handle", async () => {
      await testDb.db.user.update({ data: { handle: "olive_owner" }, where: { id: owner.id } });

      const check = (user: TestUser, handle: string) => usersAs(user).isHandleAvailable({ handle });
      // Someone else's, however it is typed.
      await expect(check(visitor, "olive_owner")).resolves.toEqual({ available: false });
      await expect(check(visitor, " @Olive_Owner ")).resolves.toEqual({ available: false });
      // The caller's own handle stays theirs.
      await expect(check(owner, "olive_owner")).resolves.toEqual({ available: true });
      await expect(check(visitor, "free_handle")).resolves.toEqual({ available: true });
      // Against the rules: too short, bad characters, reserved.
      for (const handle of ["ab", "has space", "admin", ""]) {
        await expect(check(visitor, handle)).resolves.toEqual({ available: false });
      }
    });

    it("needs a session", async () => {
      await expect(usersAs().isHandleAvailable({ handle: "anything" })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("user.isFavorite", () => {
    it("answers for one target without loading the favourites list", async () => {
      await expect(usersAs(visitor).isFavorite({ targetId: photographerId })).resolves.toEqual({
        isFavorite: false,
      });

      await usersAs(visitor).addFavorite({ photographerId });

      await expect(usersAs(visitor).isFavorite({ targetId: photographerId })).resolves.toEqual({
        isFavorite: true,
      });
      // Per user.
      await expect(usersAs(owner).isFavorite({ targetId: photographerId })).resolves.toEqual({
        isFavorite: false,
      });

      await usersAs(visitor).removeFavorite({ photographerId });
      await expect(usersAs(visitor).isFavorite({ targetId: photographerId })).resolves.toEqual({
        isFavorite: false,
      });
    });

    it("requires a session and a bounded id", async () => {
      await expect(usersAs().isFavorite({ targetId: photographerId })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(
        usersAs(visitor).isFavorite({ targetId: "x".repeat(65) }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // -------------------------------------------------------------------------
  describe("offset bounds", () => {
    it("discover.getMatches rejects an offset that is too large, negative or fractional", async () => {
      const discover = createDbCaller(discoverRouter, testDb.db, { user: visitor });
      for (const offset of [MAX_LIST_OFFSET + 1, -1, 0.5]) {
        await expect(discover.getMatches({ offset })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }
      await expect(discover.getMatches({ offset: MAX_LIST_OFFSET })).resolves.toEqual([]);
    });

    it("notification.getAll rejects an offset that is too large, negative or fractional", async () => {
      const notifications = createDbCaller(notificationRouter, testDb.db, { user: visitor });
      for (const offset of [MAX_LIST_OFFSET + 1, -1, 0.5]) {
        await expect(notifications.getAll({ offset })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }
      await expect(notifications.getAll({ offset: MAX_LIST_OFFSET })).resolves.toMatchObject({
        notifications: [],
        totalCount: 0,
      });
    });
  });
});
