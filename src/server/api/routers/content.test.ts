import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_IMAGE_BYTES } from "~/server/_utils/image";
import { RateLimits } from "~/server/_utils/rateLimit";
import { createDbCaller, fakeCloudinary } from "~/test/helpers/dbCaller";
import { freezeRateLimitClock } from "~/test/helpers/rateLimitClock";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

// ---------------------------------------------------------------------------
// Events, comments, likes, reviews, bookings, portfolios, profiles, search and
// place autocomplete, run against a real SQLite database.
// ---------------------------------------------------------------------------

const mockPlaceAutocomplete = vi.hoisted(() => vi.fn());

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("~/server/_lib/google", () => ({ placeAutocomplete: mockPlaceAutocomplete }));

import { bookingRouter } from "./booking";
import { eventRouter, MAX_COMMENT_LENGTH, MAX_EVENT_DURATION_HOURS } from "./event";
import { googleRouter } from "./google";
import { MAX_PORTFOLIO_IMAGES, photographerRouter } from "./photographer";
import { reviewRouter } from "./review";
import { SEARCH_MAX_LIMIT, SEARCH_MAX_OFFSET, searchRouter } from "./search";
import { userRouter } from "./user";

type TestUser = { email: string; id: string };

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
function jpegBase64(totalBytes = 256): string {
  const bytes = Buffer.alloc(totalBytes);
  Buffer.from(JPEG_HEAD).copy(bytes);
  return bytes.toString("base64");
}
const GIF_BASE64 = Buffer.from("GIF89a-not-an-allowed-type-000000").toString("base64");

const nextYear = () => new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

// Limiter windows are slices of wall-clock time; see freezeRateLimitClock.
freezeRateLimitClock();

describe("content routers against SQLite", () => {
  let testDb: TestDb;
  let owner: TestUser;
  let visitor: TestUser;
  let photographerId: string;
  let cloudinary: ReturnType<typeof fakeCloudinary>;

  const eventsAs = (user?: TestUser) =>
    createDbCaller(eventRouter, testDb.db, { cloudinaryClient: cloudinary, user });
  const photographersAs = (user?: TestUser) =>
    createDbCaller(photographerRouter, testDb.db, { cloudinaryClient: cloudinary, user });
  const reviewsAs = (user?: TestUser) => createDbCaller(reviewRouter, testDb.db, { user });
  const bookingsAs = (user?: TestUser) => createDbCaller(bookingRouter, testDb.db, { user });
  const usersAs = (user?: TestUser) => createDbCaller(userRouter, testDb.db, { user });
  const searchAs = (user?: TestUser) => createDbCaller(searchRouter, testDb.db, { user });
  const googleAs = (user?: TestUser) => createDbCaller(googleRouter, testDb.db, { user });

  async function createEvent(overrides: { isDeleted?: boolean; title?: string } = {}) {
    return testDb.db.event.create({
      data: {
        date: new Date("2031-06-01T12:00:00Z"),
        location: "Austin, TX",
        photographerId,
        title: "Wedding",
        ...overrides,
      },
    });
  }

  /** `user` has completed a booking on one of the owner's events: they may review. */
  async function workedTogether(user: TestUser) {
    const event = await createEvent({ title: "Past job" });
    await testDb.db.booking.create({
      data: { applicantId: user.id, eventId: event.id, ownerId: owner.id, status: "completed" },
    });
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
    await raw.favorite.deleteMany();
    await raw.review.deleteMany();
    await raw.booking.deleteMany();
    await raw.commentLike.deleteMany();
    await raw.comment.deleteMany();
    await raw.eventLike.deleteMany();
    await raw.event.deleteMany();
    await raw.portfolioImage.deleteMany();
    await raw.photographer.deleteMany();
    await raw.user.deleteMany();
    mockPlaceAutocomplete.mockReset();
    mockPlaceAutocomplete.mockResolvedValue({ isErr: false, isOk: true, value: ["Austin, TX, USA"] });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    cloudinary = fakeCloudinary();

    owner = await createTestUser(testDb.db, { firstName: "Olive", lastName: "Owner" });
    visitor = await createTestUser(testDb.db, { firstName: "Vic", lastName: "Visitor" });
    photographerId = (
      await testDb.db.photographer.create({
        data: { companyName: "Olive Photo", location: "Austin, TX", name: "Olive Owner", userId: owner.id },
      })
    ).id;
  });

  // -------------------------------------------------------------------------
  describe("endpoints that used to be public", () => {
    it("search.searchAll requires a session", async () => {
      await expect(searchAs().searchAll({ query: "olive" })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("google.getAutocompleteLocations requires a session", async () => {
      await expect(
        googleAs().getAutocompleteLocations({ query: "Austin" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(mockPlaceAutocomplete).not.toHaveBeenCalled();
    });

    it("photographer.search (the unbounded directory dump) is gone", () => {
      expect(Object.keys(photographerRouter._def.procedures)).not.toContain("search");
    });
  });

  // -------------------------------------------------------------------------
  describe("search.searchAll", () => {
    it("validates limit and offset", async () => {
      const search = searchAs(visitor);
      for (const input of [
        { limit: SEARCH_MAX_LIMIT + 1, query: "o" },
        { limit: 0, query: "o" },
        { limit: 1.5, query: "o" },
        { offset: -1, query: "o" },
        { offset: SEARCH_MAX_OFFSET + 1, query: "o" },
        { offset: 0.5, query: "o" },
        { query: "x".repeat(101) },
      ]) {
        await expect(search.searchAll(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }
    });

    it("pages through results in a stable order without repeats", async () => {
      for (const name of ["Delta", "Bravo", "Alpha", "Charlie"]) {
        const user = await createTestUser(testDb.db);
        await testDb.db.photographer.create({
          data: { companyName: "Studio", location: "Austin", name: `${name} Studio`, userId: user.id },
        });
      }

      const first = await searchAs(visitor).searchAll({ limit: 2, offset: 0, query: "Studio" });
      const second = await searchAs(visitor).searchAll({ limit: 2, offset: 2, query: "Studio" });

      expect([...first.photographers, ...second.photographers].map((p) => p.name)).toEqual([
        "Alpha Studio",
        "Bravo Studio",
        "Charlie Studio",
        "Delta Studio",
      ]);
    });

    it("omits deleted events and does not count deleted comments or likes", async () => {
      const event = await createEvent({ title: "Gala night" });
      await createEvent({ isDeleted: true, title: "Gala cancelled" });
      await testDb.db.comment.createMany({
        data: [
          { content: "kept", eventId: event.id, userId: visitor.id },
          { content: "removed", eventId: event.id, isDeleted: true, userId: visitor.id },
        ],
      });
      await testDb.db.eventLike.create({ data: { eventId: event.id, isDeleted: true, userId: visitor.id } });

      const { events } = await searchAs(visitor).searchAll({ query: "Gala" });

      expect(events.map((e) => e.title)).toEqual(["Gala night"]);
      expect(events[0]?._count).toEqual({ comments: 1, eventLikes: 0 });
    });

    it("does not expose email addresses or phone numbers", async () => {
      await testDb.db.user.update({ data: { phone: "5125550100" }, where: { id: owner.id } });
      const result = await searchAs(visitor).searchAll({ query: "Olive" });

      expect(result.photographers).toHaveLength(1);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(owner.email);
      expect(serialized).not.toContain("5125550100");
    });

    it("is rate limited per user", async () => {
      for (let i = 0; i < RateLimits.MEMBER_SEARCH.limit; i++) {
        await searchAs(visitor).searchAll({ query: "o" });
      }
      await expect(searchAs(visitor).searchAll({ query: "o" })).rejects.toMatchObject({
        code: "TOO_MANY_REQUESTS",
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("google.getAutocompleteLocations", () => {
    it("answers short input with no suggestions and no upstream call", async () => {
      await expect(googleAs(visitor).getAutocompleteLocations({ query: "Au" })).resolves.toEqual([]);
      await expect(googleAs(visitor).getAutocompleteLocations({ query: "  A  " })).resolves.toEqual([]);
      expect(mockPlaceAutocomplete).not.toHaveBeenCalled();
    });

    it("passes a UUID session token, stable across a user's keystrokes", async () => {
      await googleAs(visitor).getAutocompleteLocations({ query: "Aus" });
      await googleAs(visitor).getAutocompleteLocations({ query: "Aust" });
      await googleAs(owner).getAutocompleteLocations({ query: "Aust" });

      const tokens = mockPlaceAutocomplete.mock.calls.map((call) => call[1] as string);
      expect(tokens[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(tokens[1]).toBe(tokens[0]);
      expect(tokens[2]).not.toBe(tokens[0]);
      expect(tokens[0]).not.toContain(visitor.id);
    });

    it("uses the client's session token when one is sent", async () => {
      const sessionToken = "0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8";
      await googleAs(visitor).getAutocompleteLocations({ query: "Austin", sessionToken });
      expect(mockPlaceAutocomplete).toHaveBeenCalledWith("Austin", sessionToken);
    });

    it("is rate limited per user, counting only calls that reach Google", async () => {
      const limit = RateLimits.PLACES_AUTOCOMPLETE.limit;
      for (let i = 0; i < 10; i++) {
        await googleAs(visitor).getAutocompleteLocations({ query: "Au" });
      }
      for (let i = 0; i < limit; i++) {
        await googleAs(visitor).getAutocompleteLocations({ query: "Austin" });
      }
      await expect(
        googleAs(visitor).getAutocompleteLocations({ query: "Austin" }),
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
      expect(mockPlaceAutocomplete).toHaveBeenCalledTimes(limit);
    });
  });

  // -------------------------------------------------------------------------
  describe("public profile output", () => {
    it("getByUsername returns profile fields only: no email, phone or account data", async () => {
      await testDb.db.user.update({
        data: { handle: "olive", phone: "5125550100", stripeId: "cus_123" },
        where: { id: owner.id },
      });

      const profile = await photographersAs().getByUsername({ username: "@Olive" });

      expect(Object.keys(profile ?? {}).sort()).toEqual([
        "avatar", "bio", "companyName", "facebook", "id", "instagram", "location",
        "name", "tiktok", "twitter", "userId", "vimeo", "website", "youtube",
      ]);
      const serialized = JSON.stringify(profile);
      expect(serialized).not.toContain(owner.email);
      expect(serialized).not.toContain("5125550100");
      expect(serialized).not.toContain("cus_123");
    });

    it("public reviews carry the reviewer's name, not their user id or email", async () => {
      await workedTogether(visitor);
      await reviewsAs(visitor).create({ photographerId, rating: 5, title: "Great" });

      const reviews = await reviewsAs().getByPhotographerId({ photographerId });

      expect(reviews).toHaveLength(1);
      expect(reviews[0]).not.toHaveProperty("userId");
      expect(reviews[0]?.user).toEqual({ firstName: "Vic", lastName: "Visitor", profilePic: null });
      expect(JSON.stringify(reviews)).not.toContain(visitor.id);
      expect(JSON.stringify(reviews)).not.toContain(visitor.email);
    });

    it("public portfolio listing is capped and skips deleted images", async () => {
      await testDb.db.portfolioImage.createMany({
        data: Array.from({ length: MAX_PORTFOLIO_IMAGES + 5 }, (_, i) => ({
          image: `https://res.cloudinary.com/test-cloud/image/upload/${i}.jpg`,
          isDeleted: i === 0,
          isFeatured: false,
          photographerId,
          sortOrder: i,
          tags: "[]",
          title: `Image ${i}`,
        })),
      });

      const images = await photographersAs().getPortfolioImages({ photographerId });

      expect(images).toHaveLength(MAX_PORTFOLIO_IMAGES);
      expect(images.some((image) => image.title === "Image 0")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("uploads", () => {
    it("uploads a valid profile image and stores the Cloudinary URL", async () => {
      const result = await photographersAs(owner).uploadProfileImage({ image: jpegBase64() });

      expect(cloudinary.upload).toHaveBeenCalledWith(
        expect.objectContaining({ mime: "image/jpeg" }),
        `${owner.id}/profile`,
      );
      expect(result.profilePic).toMatch(/^https:\/\/res\.cloudinary\.com\/test-cloud\/image\/upload\//);
      await expect(
        testDb.db.photographer.findUniqueOrThrow({ where: { id: photographerId } }),
      ).resolves.toMatchObject({ avatar: result.profilePic });
    });

    it("rejects files that are not JPEG, PNG or WebP before uploading", async () => {
      await expect(
        photographersAs(owner).uploadProfileImage({ image: GIF_BASE64 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        photographersAs(owner).addPortfolioImage({ image: GIF_BASE64, title: "x" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        eventsAs(owner).create({
          date: nextYear(), description: "d", duration: 2, image: GIF_BASE64, location: "Austin", title: "t",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(cloudinary.upload).not.toHaveBeenCalled();
    });

    it("rejects a remote URL where an image is expected", async () => {
      await expect(
        photographersAs(owner).uploadProfileImage({ image: "https://evil.example/tracker.jpg" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        eventsAs(owner).update({ id: (await createEvent()).id, image: "https://evil.example/a.jpg" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(cloudinary.upload).not.toHaveBeenCalled();
    });

    it("rejects images over 5 MB before uploading", async () => {
      await expect(
        photographersAs(owner).uploadProfileImage({ image: jpegBase64(MAX_IMAGE_BYTES + 1) }),
      ).rejects.toMatchObject({ code: expect.stringMatching(/PAYLOAD_TOO_LARGE|BAD_REQUEST/) as string });
      await expect(
        photographersAs(owner).uploadProfileImage({ image: jpegBase64(MAX_IMAGE_BYTES + 4096) }),
      ).rejects.toThrow();
      expect(cloudinary.upload).not.toHaveBeenCalled();
    });

    it("caps the number of portfolio images per photographer", async () => {
      await testDb.db.portfolioImage.createMany({
        data: Array.from({ length: MAX_PORTFOLIO_IMAGES }, (_, i) => ({
          image: `https://res.cloudinary.com/test-cloud/image/upload/${i}.jpg`,
          isFeatured: false,
          photographerId,
          tags: "[]",
          title: `Image ${i}`,
        })),
      });

      await expect(
        photographersAs(owner).addPortfolioImage({ image: jpegBase64(), title: "One too many" }),
      ).rejects.toMatchObject({
        cause: { reason: "portfolio_full" },
        code: "BAD_REQUEST",
        message: `A portfolio can hold at most ${MAX_PORTFOLIO_IMAGES} images. Remove one to add another.`,
      });
      expect(cloudinary.upload).not.toHaveBeenCalled();

      // Deleting one frees a place.
      const [first] = await testDb.db.portfolioImage.findMany({ take: 1 });
      await photographersAs(owner).deletePortfolioImage({ id: first?.id ?? "" });
      await expect(
        photographersAs(owner).addPortfolioImage({ image: jpegBase64(), title: "Fits now" }),
      ).resolves.toMatchObject({ title: "Fits now" });
    });

    it("only accepts avatar URLs on the app's own Cloudinary cloud", async () => {
      const profile = {
        bio: null, companyName: "Olive Photo", facebook: null, firstName: "Olive", id: photographerId,
        instagram: null, lastName: "Owner", location: "Austin, TX", tiktok: null, twitter: null,
        vimeo: null, website: null, youtube: null,
      };

      for (const avatar of [
        "https://evil.example/pixel.gif",
        "https://res.cloudinary.com/someone-else/image/upload/a.jpg",
        "http://169.254.169.254/latest/meta-data/",
      ]) {
        await expect(photographersAs(owner).update({ ...profile, avatar })).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
      }

      const own = "https://res.cloudinary.com/test-cloud/image/upload/v1/a.jpg";
      await expect(photographersAs(owner).update({ ...profile, avatar: own })).resolves.toMatchObject({
        avatar: own,
      });
    });

    it("is rate limited per user", async () => {
      for (let i = 0; i < RateLimits.UPLOAD.limit; i++) {
        await photographersAs(owner).uploadProfileImage({ image: jpegBase64(64) });
      }
      await expect(
        photographersAs(owner).uploadProfileImage({ image: jpegBase64(64) }),
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    });

    it("does not let one user edit or delete another's portfolio image", async () => {
      const image = await photographersAs(owner).addPortfolioImage({ image: jpegBase64(), title: "Mine" });

      await expect(
        photographersAs(visitor).updatePortfolioImage({ id: image.id, title: "Hijacked" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        photographersAs(visitor).deletePortfolioImage({ id: image.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        photographersAs(visitor).reorderPortfolioImages({ images: [{ id: image.id, sortOrder: 3 }] }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // -------------------------------------------------------------------------
  describe("profile validation", () => {
    const base = {
      companyName: "Vic Photo", facebook: null, instagram: null, location: "Austin", name: "Vic Visitor",
      tiktok: null, twitter: null, vimeo: null, youtube: null,
    };

    it("validates the website URL on the server", async () => {
      for (const website of ["javascript:alert(document.cookie)", "not a url", "ftp://files.example"]) {
        await expect(
          photographersAs(visitor).create({ ...base, website }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }
      await expect(
        photographersAs(visitor).create({ ...base, website: "https://vic.photo" }),
      ).resolves.toMatchObject({ website: "https://vic.photo" });
    });

    it("normalises and validates handles, and reports a taken one as a conflict", async () => {
      await expect(usersAs(owner).updateProfile({ handle: " @Olive_99 " })).resolves.toMatchObject({
        handle: "olive_99",
      });
      for (const handle of ["ab", "has space", "admin", "x".repeat(31), "semi;colon"]) {
        await expect(usersAs(visitor).updateProfile({ handle })).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
      }
      await expect(usersAs(visitor).updateProfile({ handle: "OLIVE_99" })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("favorites are idempotent, per user, and need a real photographer", async () => {
      await usersAs(visitor).addFavorite({ photographerId });
      await usersAs(visitor).addFavorite({ photographerId });

      await expect(usersAs(visitor).getFavorites()).resolves.toHaveLength(1);
      await expect(usersAs(owner).getFavorites()).resolves.toHaveLength(0);
      await expect(
        usersAs(visitor).addFavorite({ photographerId: "no-such-photographer" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // -------------------------------------------------------------------------
  describe("events", () => {
    const valid = () => ({
      date: nextYear(), description: "Second shooter needed", duration: 6, location: "Austin, TX", title: "Wedding",
    });

    it("creates an event from valid input", async () => {
      const event = await eventsAs(owner).create(valid());
      expect(event).toMatchObject({ duration: 6, photographerId, title: "Wedding" });
      expect(event.date).toBeInstanceOf(Date);
    });

    it("rejects dates that are not full ISO timestamps, in the past, or far in the future", async () => {
      for (const date of [
        "tomorrow",
        "2031-06-01",
        "06/01/2031",
        "2031-06-01 12:00:00",
        "2000-01-01T00:00:00.000Z",
        "2999-01-01T00:00:00.000Z",
        "",
      ]) {
        await expect(eventsAs(owner).create({ ...valid(), date })).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
      }
    });

    it("requires duration to be a whole number of hours within bounds", async () => {
      for (const duration of [0, -1, 1.5, MAX_EVENT_DURATION_HOURS + 1, Number.MAX_SAFE_INTEGER]) {
        await expect(eventsAs(owner).create({ ...valid(), duration })).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
      }
      await expect(
        eventsAs(owner).create({ ...valid(), duration: MAX_EVENT_DURATION_HOURS }),
      ).resolves.toBeDefined();
    });

    it("only lets the owner update or delete an event", async () => {
      const event = await createEvent();

      await expect(
        eventsAs(visitor).update({ id: event.id, title: "Hijacked" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(eventsAs(visitor).delete({ id: event.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(eventsAs(owner).update({ id: event.id, title: "Renamed" })).resolves.toMatchObject({
        title: "Renamed",
      });
    });

    it("pages a photographer's events and caps the page size", async () => {
      for (let i = 0; i < 5; i++) await createEvent({ title: `Event ${i}` });

      const page = await eventsAs(visitor).getByPhotographerId({ limit: 2, photographerId });
      const next = await eventsAs(visitor).getByPhotographerId({
        cursor: page[1]?.id, limit: 2, photographerId,
      });

      expect(page).toHaveLength(2);
      expect(next).toHaveLength(2);
      expect(new Set([...page, ...next].map((e) => e.id)).size).toBe(4);
      await expect(
        eventsAs(visitor).getByPhotographerId({ limit: 51, photographerId }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("bounds getRecentByLocation's limit and locations", async () => {
      await expect(
        eventsAs(visitor).getRecentByLocation({ limit: 10_000, locations: ["Austin"] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        eventsAs(visitor).getRecentByLocation({ locations: Array.from({ length: 11 }, () => "Austin") }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        eventsAs(visitor).getRecentByLocation({ locations: ["Austin, TX, USA"] }),
      ).resolves.toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe("comments and likes", () => {
    it("caps comment length and refuses comments on deleted or unknown events", async () => {
      const event = await createEvent();
      const deleted = await createEvent({ isDeleted: true });

      await expect(
        eventsAs(visitor).addCommentToEvent({ content: "x".repeat(MAX_COMMENT_LENGTH), eventId: event.id }),
      ).resolves.toBeDefined();
      await expect(
        eventsAs(visitor).addCommentToEvent({ content: "x".repeat(MAX_COMMENT_LENGTH + 1), eventId: event.id }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        eventsAs(visitor).addCommentToEvent({ content: "hello", eventId: deleted.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        eventsAs(visitor).addCommentToEvent({ content: "hello", eventId: "missing" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("rate limits comments per user", async () => {
      const event = await createEvent();
      for (let i = 0; i < RateLimits.COMMENT_CREATE.limit; i++) {
        await eventsAs(visitor).addCommentToEvent({ content: `c${i}`, eventId: event.id });
      }
      await expect(
        eventsAs(visitor).addCommentToEvent({ content: "spam", eventId: event.id }),
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    });

    it("counts only live comments", async () => {
      const event = await createEvent();
      await testDb.db.comment.createMany({
        data: [
          { content: "kept", eventId: event.id, userId: visitor.id },
          { content: "removed", eventId: event.id, isDeleted: true, userId: visitor.id },
        ],
      });

      await expect(eventsAs(visitor).getCommentCountByEventId({ eventId: event.id })).resolves.toBe(1);
      await expect(eventsAs(visitor).getById({ id: event.id })).resolves.toMatchObject({ commentCount: 1 });
      const comments = await eventsAs(visitor).getCommentsByEventId({ eventId: event.id });
      expect(comments.map((c) => c.content)).toEqual(["kept"]);
    });

    it("keeps one like per user per event, however often it is sent", async () => {
      const event = await createEvent();

      await Promise.all([
        eventsAs(visitor).addLikeToEvent({ targetId: event.id }),
        eventsAs(visitor).addLikeToEvent({ targetId: event.id }),
        eventsAs(visitor).addLikeToEvent({ targetId: event.id }),
      ]);
      await eventsAs(owner).addLikeToEvent({ targetId: event.id });

      await expect(testDb.raw.eventLike.count()).resolves.toBe(2);

      await eventsAs(visitor).removeLikeFromEvent({ targetId: event.id });
      await expect(testDb.db.eventLike.count()).resolves.toBe(1);
      await eventsAs(visitor).addLikeToEvent({ targetId: event.id });
      await expect(testDb.db.eventLike.count()).resolves.toBe(2);
      await expect(testDb.raw.eventLike.count()).resolves.toBe(2);
    });

    it("toggles a comment like without ever creating a second row", async () => {
      const event = await createEvent();
      const comment = await eventsAs(owner).addCommentToEvent({ content: "hi", eventId: event.id });
      const toggle = () => eventsAs(visitor).addOrRemoveEventCommentLike({ targetId: comment.id });

      await expect(toggle()).resolves.toEqual({ liked: true });
      await expect(eventsAs(visitor).getCommentById({ id: comment.id })).resolves.toMatchObject({
        commentLikes: 1, isLiked: true,
      });
      await expect(eventsAs(owner).getCommentById({ id: comment.id })).resolves.toMatchObject({
        commentLikes: 1, isLiked: false,
      });

      await expect(toggle()).resolves.toEqual({ liked: false });
      await expect(eventsAs(visitor).getCommentById({ id: comment.id })).resolves.toMatchObject({
        commentLikes: 0, isLiked: false,
      });

      await expect(toggle()).resolves.toEqual({ liked: true });
      await expect(testDb.raw.commentLike.count()).resolves.toBe(1);
    });

    it("lets only the author delete a comment", async () => {
      const event = await createEvent();
      const comment = await eventsAs(owner).addCommentToEvent({ content: "mine", eventId: event.id });

      await expect(
        eventsAs(visitor).deleteCommentFromEvent({ id: comment.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(eventsAs(owner).deleteCommentFromEvent({ id: comment.id })).resolves.toEqual({
        id: comment.id,
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("reviews", () => {
    const review = { photographerId: "", rating: 5, title: "Great to work with" };

    beforeEach(async () => {
      await workedTogether(visitor);
    });

    it("allows one review per reviewer per photographer", async () => {
      await reviewsAs(visitor).create({ ...review, photographerId });

      await expect(
        reviewsAs(visitor).create({ ...review, photographerId, rating: 1 }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: "You have already reviewed this photographer",
      });
      await expect(testDb.db.review.count()).resolves.toBe(1);
    });

    it("stores one review when the same reviewer submits twice at once", async () => {
      const results = await Promise.allSettled([
        reviewsAs(visitor).create({ ...review, photographerId }),
        reviewsAs(visitor).create({ ...review, photographerId }),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected");
      expect(rejected).toMatchObject({ reason: { code: "CONFLICT" } });
      await expect(testDb.db.review.count()).resolves.toBe(1);
    });

    it("refuses self-reviews and unknown photographers with proper errors", async () => {
      await expect(
        reviewsAs(owner).create({ ...review, photographerId }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        reviewsAs(visitor).create({ ...review, photographerId: "missing" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("computes the average in the database", async () => {
      const third = await createTestUser(testDb.db);
      await workedTogether(third);
      await reviewsAs(visitor).create({ ...review, photographerId, rating: 5 });
      await reviewsAs(third).create({ ...review, photographerId, rating: 4 });

      await expect(reviewsAs().getAverageRating({ photographerId })).resolves.toEqual({
        average: 4.5, count: 2,
      });
      await expect(reviewsAs().getAverageRating({ photographerId: "missing" })).resolves.toEqual({
        average: 0, count: 0,
      });
    });

    it("lets only the author delete a review", async () => {
      const created = await reviewsAs(visitor).create({ ...review, photographerId });
      await expect(reviewsAs(owner).delete({ id: created.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(reviewsAs(visitor).delete({ id: created.id })).resolves.toEqual({ id: created.id });
    });
  });

  // -------------------------------------------------------------------------
  describe("bookings", () => {
    it("does not accept an application to a deleted event", async () => {
      const deleted = await createEvent({ isDeleted: true });

      await expect(
        bookingsAs(visitor).applyToEvent({ eventId: deleted.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(testDb.raw.booking.count()).resolves.toBe(0);
    });

    it("answers a double submit with a conflict, not a server error", async () => {
      const event = await createEvent();

      const results = await Promise.allSettled([
        bookingsAs(visitor).applyToEvent({ eventId: event.id }),
        bookingsAs(visitor).applyToEvent({ eventId: event.id }),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({
        reason: { code: "CONFLICT" },
      });
    });

    it("pages booking lists and hides deleted bookings", async () => {
      const applicants = [];
      for (let i = 0; i < 3; i++) applicants.push(await createTestUser(testDb.db));
      const event = await createEvent();
      for (const applicant of applicants) {
        await bookingsAs(applicant).applyToEvent({ eventId: event.id });
      }
      await testDb.raw.booking.updateMany({
        data: { isDeleted: true },
        where: { applicantId: applicants[0]?.id },
      });

      const all = await bookingsAs(owner).getReceivedApplications();
      const firstPage = await bookingsAs(owner).getReceivedApplications({ limit: 1 });
      const secondPage = await bookingsAs(owner).getReceivedApplications({
        cursor: firstPage[0]?.id, limit: 1,
      });

      expect(all).toHaveLength(2);
      expect([firstPage[0]?.id, secondPage[0]?.id]).toEqual(all.map((b) => b.id));
      await expect(bookingsAs(owner).getByEventId({ eventId: event.id })).resolves.toHaveLength(2);
      await expect(
        bookingsAs(visitor).getByEventId({ eventId: event.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
