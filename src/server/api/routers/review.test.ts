import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorReason } from "~/_utils/errorReason";
import { reasonOf } from "~/server/api/reasonedError";
import { createDbCaller } from "~/test/helpers/dbCaller";
import { freezeRateLimitClock } from "~/test/helpers/rateLimitClock";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("~/_lib", () => ({ cloudinaryClient: null }));

import { reviewRouter } from "./review";

type TestUser = { email: string; id: string };

freezeRateLimitClock();

describe("reviews: only after working together", () => {
  let testDb: TestDb;
  let lead: TestUser;
  let second: TestUser;
  let stranger: TestUser;
  let leadPhotographerId: string;
  let secondPhotographerId: string;

  const as = (user: TestUser) => createDbCaller(reviewRouter, testDb.db, { user });
  const review = { rating: 5, title: "A pleasure to work with" };

  const errorOf = (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error("expected a rejection");
      },
      (error: unknown) => error,
    );

  /** `second` applied to an event of `lead`; the booking is in `status`. */
  async function booking(status: string, options: { eventDeleted?: boolean; isDeleted?: boolean } = {}) {
    const event = await testDb.db.event.create({
      data: {
        date: new Date("2029-05-01T12:00:00Z"),
        isDeleted: options.eventDeleted ?? false,
        location: "Austin",
        photographerId: leadPhotographerId,
        title: "Wedding",
      },
    });
    return testDb.db.booking.create({
      data: {
        applicantId: second.id,
        eventId: event.id,
        isDeleted: options.isDeleted ?? false,
        ownerId: lead.id,
        status,
      },
    });
  }

  beforeEach(async () => {
    testDb = await createTestDb();
    lead = await createTestUser(testDb.db);
    second = await createTestUser(testDb.db);
    stranger = await createTestUser(testDb.db);
    const photographer = (user: TestUser, name: string) =>
      testDb.db.photographer.create({
        data: { companyName: `${name} Photo`, location: "Austin", name, userId: user.id },
      });
    leadPhotographerId = (await photographer(lead, "Lead")).id;
    secondPhotographerId = (await photographer(second, "Second")).id;
    await photographer(stranger, "Stranger");
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("refuses a review from someone who never worked with the photographer", async () => {
    const error = await errorOf(as(stranger).create({ ...review, photographerId: leadPhotographerId }));

    expect(error).toMatchObject({ code: "FORBIDDEN" });
    expect(reasonOf(error)).toBe(ErrorReason.REVIEW_NOT_ELIGIBLE);
    expect(await testDb.db.review.count()).toBe(0);
  });

  it.each(["applied", "accepted", "declined", "canceled"])(
    "refuses a review while the booking is only %s",
    async (status) => {
      await booking(status);

      expect(
        reasonOf(await errorOf(as(second).create({ ...review, photographerId: leadPhotographerId }))),
      ).toBe(ErrorReason.REVIEW_NOT_ELIGIBLE);
    },
  );

  it("lets the second shooter review the lead after a completed booking", async () => {
    await booking("completed");

    const created = await as(second).create({ ...review, photographerId: leadPhotographerId });

    expect(created).toMatchObject({ photographerId: leadPhotographerId, rating: 5, userId: second.id });
  });

  it("lets the lead review the second shooter too (either direction)", async () => {
    await booking("completed");

    const created = await as(lead).create({ ...review, photographerId: secondPhotographerId });

    expect(created).toMatchObject({ photographerId: secondPhotographerId, userId: lead.id });
  });

  it("does not count a deleted booking or a booking on a deleted event", async () => {
    await booking("completed", { isDeleted: true });
    await booking("completed", { eventDeleted: true });

    expect(
      reasonOf(await errorOf(as(second).create({ ...review, photographerId: leadPhotographerId }))),
    ).toBe(ErrorReason.REVIEW_NOT_ELIGIBLE);
  });

  it("allows one review per pair, with a typed reason for the second", async () => {
    await booking("completed");
    await booking("completed");
    await as(second).create({ ...review, photographerId: leadPhotographerId });

    const error = await errorOf(as(second).create({ ...review, photographerId: leadPhotographerId }));

    expect(error).toMatchObject({ code: "CONFLICT" });
    expect(reasonOf(error)).toBe(ErrorReason.REVIEW_EXISTS);
    expect(await testDb.db.review.count()).toBe(1);
  });

  it("refuses a self-review with a typed reason", async () => {
    const error = await errorOf(as(lead).create({ ...review, photographerId: leadPhotographerId }));

    expect(error).toMatchObject({ code: "BAD_REQUEST" });
    expect(reasonOf(error)).toBe(ErrorReason.REVIEW_SELF);
  });

  describe("getMyReviewState", () => {
    const state = (user: TestUser, photographerId: string) => as(user).getMyReviewState({ photographerId });

    it("says no before working together", async () => {
      await booking("accepted");

      expect(await state(second, leadPhotographerId)).toEqual({
        blocker: "no_completed_booking",
        canReview: false,
        hasReviewed: false,
        myReview: null,
      });
    });

    it("says yes after a completed booking, to both parties", async () => {
      await booking("completed");

      expect(await state(second, leadPhotographerId)).toMatchObject({ blocker: null, canReview: true });
      expect(await state(lead, secondPhotographerId)).toMatchObject({ blocker: null, canReview: true });
      expect(await state(stranger, leadPhotographerId)).toMatchObject({ canReview: false });
    });

    it("returns the caller's review once written, and stops offering the form", async () => {
      await booking("completed");
      const created = await as(second).create({ ...review, description: "On time", photographerId: leadPhotographerId });

      expect(await state(second, leadPhotographerId)).toEqual({
        blocker: "already_reviewed",
        canReview: false,
        hasReviewed: true,
        myReview: {
          createdAt: created.createdAt,
          description: "On time",
          id: created.id,
          rating: 5,
          title: "A pleasure to work with",
        },
      });
      // Someone else's review is not "mine".
      expect((await state(lead, secondPhotographerId)).hasReviewed).toBe(false);
    });

    it("never offers a review of yourself, or of an unknown photographer", async () => {
      expect(await state(lead, leadPhotographerId)).toMatchObject({ blocker: "self", canReview: false });
      expect(await state(lead, "missing")).toMatchObject({ blocker: "no_completed_booking", canReview: false });
    });

    it("agrees with create: canReview is true exactly when create succeeds", async () => {
      await booking("completed");
      for (const [user, photographerId] of [
        [second, leadPhotographerId],
        [lead, secondPhotographerId],
        [stranger, leadPhotographerId],
        [lead, leadPhotographerId],
      ] as const) {
        const { canReview } = await state(user, photographerId);
        const created = await as(user).create({ ...review, photographerId }).then(() => true, () => false);
        expect(created).toBe(canReview);
      }
    });
  });

  it("aggregates the average rating in SQL", async () => {
    await booking("completed");
    await as(second).create({ ...review, photographerId: leadPhotographerId, rating: 4 });

    expect(await as(second).getAverageRating({ photographerId: leadPhotographerId })).toEqual({
      average: 4,
      count: 1,
    });
  });
});
