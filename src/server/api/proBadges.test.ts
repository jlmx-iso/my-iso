import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDbCaller } from "~/test/helpers/dbCaller";
import { makePro } from "~/test/helpers/pro";
import { freezeRateLimitClock } from "~/test/helpers/rateLimitClock";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("~/_lib", () => ({ cloudinaryClient: null }));
vi.mock("~/server/_lib/posthog", () => ({ captureEvent: vi.fn() }));

import { bookingRouter } from "./routers/booking";
import { eventRouter } from "./routers/event";
import { messageRouter } from "./routers/message";
import { photographerRouter } from "./routers/photographer";

freezeRateLimitClock();

type TestUser = { email: string; id: string };

/**
 * The Pro badge on every surface that shows a person: derived on the server
 * from the stored subscription, never from the client, and looked up once
 * per page rather than once per row.
 */
describe("Pro badge payloads", () => {
  let testDb: TestDb;
  let pro: TestUser;
  let free: TestUser;
  let lapsed: TestUser;
  const profiles = new Map<string, string>();

  async function profile(user: TestUser, name: string) {
    const created = await testDb.db.photographer.create({
      data: { companyName: "Studio", location: "Austin", name, userId: user.id },
    });
    profiles.set(user.id, created.id);
    return created;
  }

  async function event(owner: TestUser, title: string) {
    return testDb.db.event.create({
      data: {
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        location: "Austin",
        photographerId: profiles.get(owner.id) ?? "",
        title,
      },
    });
  }

  /** Counts subscription lookups made while `run` runs. */
  async function lookups<T>(run: () => Promise<T>): Promise<{ count: number; result: T }> {
    const findMany = vi.spyOn(testDb.db.subscription, "findMany");
    try {
      const result = await run();
      return { count: findMany.mock.calls.length, result };
    } finally {
      findMany.mockRestore();
    }
  }

  beforeEach(async () => {
    testDb = await createTestDb();
    pro = await createTestUser(testDb.db);
    free = await createTestUser(testDb.db);
    lapsed = await createTestUser(testDb.db);
    await makePro(testDb.db, pro.id);
    await makePro(testDb.db, lapsed.id, { cancelAt: new Date(Date.now() - 60_000) });
    await profile(pro, "Pat Pro");
    await profile(free, "Fran Free");
    await profile(lapsed, "Lee Lapsed");
  });

  afterEach(async () => {
    await testDb.close();
    profiles.clear();
  });

  it("profile: getByUserId and the public getByUsername say whether the member is Pro", async () => {
    await testDb.db.user.update({ data: { handle: "pat" }, where: { id: pro.id } });
    const as = createDbCaller(photographerRouter, testDb.db, { user: free });

    expect(await as.getByUserId({ userId: pro.id })).toMatchObject({ isPro: true, name: "Pat Pro" });
    expect(await as.getByUserId({ userId: free.id })).toMatchObject({ isPro: false });
    expect(await as.getByUserId({ userId: lapsed.id })).toMatchObject({ isPro: false });
    expect(await as.getByUserId({ userId: "nobody" })).toBeNull();
    expect(await createDbCaller(photographerRouter, testDb.db).getByUsername({ username: "pat" })).toMatchObject({ isPro: true });
  });

  it("events: the feed marks each owner, with one lookup for the page", async () => {
    for (const owner of [pro, free, lapsed, pro, free]) await event(owner, "Wedding");

    const { count, result } = await lookups(() =>
      createDbCaller(eventRouter, testDb.db, { user: free }).getFeedPage({ limit: 10 }),
    );

    expect(count).toBe(1);
    expect(result.items).toHaveLength(5);
    for (const item of result.items) expect(item.photographer.isPro).toBe(item.photographer.userId === pro.id);
  });

  it("events: getById marks the owner", async () => {
    const proEvent = await event(pro, "Pro wedding");
    const freeEvent = await event(free, "Free wedding");
    const as = createDbCaller(eventRouter, testDb.db, { user: lapsed });

    expect((await as.getById({ id: proEvent.id })).photographer.isPro).toBe(true);
    expect((await as.getById({ id: freeEvent.id })).photographer.isPro).toBe(false);
  });

  it("applicants: received applications and an event's applicant list mark each applicant, once per page", async () => {
    const owned = await event(free, "Free's wedding");
    for (const applicant of [pro, lapsed]) {
      await testDb.db.booking.create({ data: { applicantId: applicant.id, eventId: owned.id, ownerId: free.id } });
    }
    const as = createDbCaller(bookingRouter, testDb.db, { user: free });

    const received = await lookups(() => as.getReceivedApplicationsPage({ limit: 10 }));
    expect(received.count).toBe(1);
    expect(Object.fromEntries(received.result.items.map((row) => [row.applicant.id, row.applicant.isPro]))).toEqual({
      [lapsed.id]: false,
      [pro.id]: true,
    });

    const list = await lookups(() => as.getByEventId({ eventId: owned.id }));
    expect(list.count).toBe(1);
    expect(list.result.map((row) => row.applicant.isPro).sort()).toEqual([false, true]);

    const plain = await as.getReceivedApplications({ limit: 10 });
    expect(plain.find((row) => row.applicant.id === pro.id)?.applicant.isPro).toBe(true);
  });

  it("applications sent: the event owner is marked", async () => {
    const proEvent = await event(pro, "Pro's wedding");
    await testDb.db.booking.create({ data: { applicantId: free.id, eventId: proEvent.id, ownerId: pro.id } });
    const as = createDbCaller(bookingRouter, testDb.db, { user: free });

    expect((await as.getMyApplicationsPage({ limit: 10 })).items[0]?.owner).toMatchObject({ id: pro.id, isPro: true });
    expect((await as.getMyApplications({ limit: 10 }))[0]?.owner.isPro).toBe(true);
  });

  it("messages: the thread's participants are marked, in one lookup", async () => {
    const thread = await testDb.db.messageThread.create({
      data: { participants: { connect: [{ id: free.id }, { id: pro.id }] } },
    });
    await testDb.db.message.create({ data: { content: "hello", senderId: pro.id, threadId: thread.id } });

    const { count, result } = await lookups(() =>
      createDbCaller(messageRouter, testDb.db, { user: free }).getThreadById({ threadId: thread.id }),
    );

    expect(count).toBe(1);
    expect(Object.fromEntries((result?.participants ?? []).map((participant) => [participant.id, participant.isPro]))).toEqual({
      [free.id]: false,
      [pro.id]: true,
    });
  });
});
