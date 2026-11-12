import type { AnyTRPCRouter } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorReason, getErrorReason } from "~/_utils/errorReason";
import { ACTIVE_BOOKING_STATUSES, threadParticipantKey } from "~/server/_db/messaging";
import { MAX_NEW_CONVERSATIONS_PER_DAY, RateLimits } from "~/server/_utils/rateLimit";
import { reasonOf } from "~/server/api/reasonedError";
import { createDbCaller } from "~/test/helpers/dbCaller";
import { freezeRateLimitClock, spendRateLimit } from "~/test/helpers/rateLimitClock";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));

import { MAX_MESSAGE_LENGTH, MAX_RECIPIENT_RESULTS, messageRouter } from "./message";

type TestUser = { email: string; id: string };

/** A `Prisma.sql` statement, as $queryRaw receives it. */
function isSqlObject(query: unknown): query is { sql: string; values: unknown[] } {
  return (
    typeof query === "object" &&
    query !== null &&
    "sql" in query &&
    typeof query.sql === "string" &&
    "values" in query &&
    Array.isArray(query.values)
  );
}

// Limiter windows are slices of wall-clock time; see freezeRateLimitClock.
const limiterClock = freezeRateLimitClock();

describe("messageRouter against SQLite", () => {
  let testDb: TestDb;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;

  const as = (user: TestUser) => createDbCaller(messageRouter, testDb.db, { user });
  const anonymous = () => createDbCaller(messageRouter, testDb.db);

  /** Matches two users in Discover. */
  async function match(a: TestUser, b: TestUser) {
    const [user1Id, user2Id] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    await testDb.db.match.create({ data: { user1Id, user2Id } });
  }

  /** `applicant` applies to an event owned by `owner`. */
  async function book(
    applicant: TestUser,
    owner: TestUser,
    options: { eventDeleted?: boolean; status?: string } = {},
  ) {
    const photographer = await testDb.db.photographer.upsert({
      create: { companyName: "Co", location: "Austin", name: "Owner", userId: owner.id },
      update: {},
      where: { userId: owner.id },
    });
    const event = await testDb.db.event.create({
      data: {
        date: new Date("2031-01-01"),
        isDeleted: options.eventDeleted ?? false,
        location: "Austin",
        photographerId: photographer.id,
        title: "Wedding",
      },
    });
    return testDb.db.booking.create({
      data: {
        applicantId: applicant.id,
        eventId: event.id,
        ownerId: owner.id,
        ...(options.status ? { status: options.status } : {}),
      },
    });
  }

  /** The error `promise` rejects with. */
  const errorOf = (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error("expected a rejection");
      },
      (error: unknown) => error,
    );

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    const { raw } = testDb;
    await raw.rateLimit.deleteMany();
    await raw.match.deleteMany();
    await raw.booking.deleteMany();
    await raw.event.deleteMany();
    await raw.message.deleteMany();
    await raw.messageThread.deleteMany();
    await raw.photographer.deleteMany();
    await raw.user.deleteMany();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    alice = await createTestUser(testDb.db, { firstName: "Alice", isDiscoverable: true });
    bob = await createTestUser(testDb.db, { firstName: "Bob", isDiscoverable: true });
    carol = await createTestUser(testDb.db, { firstName: "Carol", isDiscoverable: false });
  });

  describe("createThread", () => {
    it("requires a session", async () => {
      await expect(
        anonymous().createThread({ initialMessage: "hi", participants: [bob.id] }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("lets anyone open a conversation with a discoverable member", async () => {
      // Alice and Bob have no match, booking or earlier messages.
      const thread = await as(alice).createThread({ initialMessage: "hi", participants: [bob.id] });

      expect(thread.participantKey).toBe(threadParticipantKey([alice.id, bob.id]));
    });

    it("refuses a first message to a non-discoverable stranger, with a reason", async () => {
      const error = await errorOf(
        as(alice).createThread({ initialMessage: "hi", participants: [carol.id] }),
      );

      expect(error).toMatchObject({ code: "FORBIDDEN" });
      expect(reasonOf(error)).toBe(ErrorReason.RECIPIENT_NOT_MESSAGEABLE);
      await expect(testDb.db.messageThread.count()).resolves.toBe(0);
      await expect(testDb.raw.message.count()).resolves.toBe(0);
    });

    it("answers the same for a user id that does not exist", async () => {
      const hidden = await errorOf(
        as(alice).createThread({ initialMessage: "hi", participants: [carol.id] }),
      );
      const missing = await errorOf(
        as(alice).createThread({ initialMessage: "hi", participants: ["no-such-user"] }),
      );

      expect(missing).toMatchObject({ code: "FORBIDDEN" });
      expect(reasonOf(missing)).toBe(reasonOf(hidden));
      expect((missing as Error).message).toBe((hidden as Error).message);
    });

    it("requires every member of a group conversation to be messageable", async () => {
      await expect(
        as(alice).createThread({ initialMessage: "hi", participants: [bob.id, carol.id] }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(testDb.db.messageThread.count()).resolves.toBe(0);
    });

    it("lets a non-discoverable member write first, which opens the way back", async () => {
      // Carol (hidden) may write to Alice (discoverable) ...
      const thread = await as(carol).createThread({ initialMessage: "hello", participants: [alice.id] });
      // ... and Alice, who could not have started it, can now answer,
      const reply = await as(alice).createThread({ initialMessage: "hi back", participants: [carol.id] });
      expect(reply.id).toBe(thread.id);
      // including in a new group that contains Carol.
      await expect(
        as(alice).createThread({ initialMessage: "all", participants: [carol.id, bob.id] }),
      ).resolves.toMatchObject({ id: expect.any(String) as string });
    });

    it("allows a non-discoverable recipient after a match", async () => {
      await match(alice, carol);
      await expect(
        as(alice).createThread({ initialMessage: "hi", participants: [carol.id] }),
      ).resolves.toMatchObject({ id: expect.any(String) as string });
    });

    it.each(ACTIVE_BOOKING_STATUSES)(
      "allows a non-discoverable recipient with a booking that is %s, in either direction",
      async (status) => {
        const dave = await createTestUser(testDb.db, { firstName: "Dave", isDiscoverable: false });
        // Carol applied to Dave's event; neither is discoverable.
        await book(carol, dave, { status });

        await expect(
          as(dave).createThread({ initialMessage: "thanks for applying", participants: [carol.id] }),
        ).resolves.toMatchObject({ id: expect.any(String) as string });

        await testDb.raw.message.deleteMany();
        await testDb.raw.messageThread.deleteMany();
        await expect(
          as(carol).createThread({ initialMessage: "any news?", participants: [dave.id] }),
        ).resolves.toMatchObject({ id: expect.any(String) as string });
      },
    );

    it.each(["declined", "canceled", "cancelled"])(
      "does not let a %s booking unlock messaging",
      async (status) => {
        const dave = await createTestUser(testDb.db, { firstName: "Dave", isDiscoverable: false });
        await book(carol, dave, { status });

        for (const [from, to] of [[carol, dave], [dave, carol]] as const) {
          const error = await errorOf(
            as(from).createThread({ initialMessage: "hi", participants: [to.id] }),
          );
          expect(error).toMatchObject({ code: "FORBIDDEN" });
          expect(reasonOf(error)).toBe(ErrorReason.RECIPIENT_NOT_MESSAGEABLE);
        }
      },
    );

    it("does not count a booking on a deleted event, or a deleted booking", async () => {
      const dave = await createTestUser(testDb.db, { firstName: "Dave", isDiscoverable: false });
      await book(carol, dave, { eventDeleted: true, status: "accepted" });
      const live = await book(carol, dave, { status: "accepted" });
      await testDb.raw.booking.update({ data: { isDeleted: true }, where: { id: live.id } });

      await expect(
        as(dave).createThread({ initialMessage: "hi", participants: [carol.id] }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("stops honouring a booking once it is declined", async () => {
      const dave = await createTestUser(testDb.db, { firstName: "Dave", isDiscoverable: false });
      const booking = await book(carol, dave);
      await testDb.db.booking.update({ data: { status: "declined" }, where: { id: booking.id } });

      await expect(
        as(carol).createThread({ initialMessage: "why?", participants: [dave.id] }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rejects an empty participant list, too many participants, and only yourself", async () => {
      await expect(
        as(alice).createThread({ initialMessage: "hi", participants: [] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        as(alice).createThread({
          initialMessage: "hi",
          participants: Array.from({ length: 10 }, (_, i) => `user-${i}`),
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        as(alice).createThread({ initialMessage: "hi", participants: [alice.id, alice.id] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejects an over-long or blank first message", async () => {
      await match(alice, bob);
      await expect(
        as(alice).createThread({
          initialMessage: "x".repeat(MAX_MESSAGE_LENGTH + 1),
          participants: [bob.id],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        as(alice).createThread({ initialMessage: "   ", participants: [bob.id] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("creates the thread and first message after a match", async () => {
      await match(alice, bob);

      const thread = await as(alice).createThread({ initialMessage: "hello", participants: [bob.id] });

      expect(thread.participantKey).toBe(threadParticipantKey([alice.id, bob.id]));
      expect(await testDb.db.message.findMany({ where: { threadId: thread.id } })).toMatchObject([
        { content: "hello", senderId: alice.id },
      ]);
    });

    it("returns the existing thread instead of creating a duplicate", async () => {
      await match(alice, bob);

      const first = await as(alice).createThread({ initialMessage: "one", participants: [bob.id] });
      // Order and duplicates in the list do not matter, nor who calls.
      const second = await as(bob).createThread({
        initialMessage: "two",
        participants: [alice.id, alice.id, bob.id],
      });

      expect(second.id).toBe(first.id);
      await expect(testDb.db.messageThread.count()).resolves.toBe(1);
      expect(
        (await testDb.db.message.findMany({ orderBy: { createdAt: "asc" } })).map((m) => m.content),
      ).toEqual(["one", "two"]);
    });

    it("creates one thread when both people start the conversation at once", async () => {
      await match(alice, bob);

      const [a, b] = await Promise.all([
        as(alice).createThread({ initialMessage: "from alice", participants: [bob.id] }),
        as(bob).createThread({ initialMessage: "from bob", participants: [alice.id] }),
      ]);

      expect(a.id).toBe(b.id);
      await expect(testDb.db.messageThread.count()).resolves.toBe(1);
      await expect(testDb.db.message.count()).resolves.toBe(2);
    });

    it("lets the recipient of a conversation reply into it", async () => {
      await match(alice, bob);
      const thread = await as(alice).createThread({ initialMessage: "hi", participants: [bob.id] });
      // The match is gone; the thread (Alice having written first) remains.
      await testDb.raw.match.deleteMany();

      const reply = await as(bob).createThread({ initialMessage: "hi back", participants: [alice.id] });
      expect(reply.id).toBe(thread.id);
    });

    it("adopts a thread created before participant keys existed", async () => {
      const legacy = await testDb.db.messageThread.create({
        data: { participants: { connect: [{ id: alice.id }, { id: bob.id }] } },
      });

      const thread = await as(alice).createThread({ initialMessage: "hi", participants: [bob.id] });

      expect(thread.id).toBe(legacy.id);
      expect(thread.participantKey).toBe(threadParticipantKey([alice.id, bob.id]));
    });

    describe("daily cap on new conversations", () => {
      const strangers = (count: number) =>
        Promise.all(
          Array.from({ length: count }, (_, i) =>
            createTestUser(testDb.db, { firstName: `Stranger${i}`, isDiscoverable: true }),
          ),
        );

      it(`refuses conversation ${MAX_NEW_CONVERSATIONS_PER_DAY + 1} of the day with its own reason`, async () => {
        const people = await strangers(MAX_NEW_CONVERSATIONS_PER_DAY + 1);
        for (const person of people.slice(0, MAX_NEW_CONVERSATIONS_PER_DAY)) {
          await as(alice).createThread({ initialMessage: "hi", participants: [person.id] });
        }

        const error = await errorOf(
          as(alice).createThread({
            initialMessage: "hi",
            participants: [people[MAX_NEW_CONVERSATIONS_PER_DAY]?.id ?? ""],
          }),
        );

        expect(error).toMatchObject({ code: "TOO_MANY_REQUESTS" });
        expect(reasonOf(error)).toBe(ErrorReason.NEW_CONVERSATION_LIMIT);
        await expect(testDb.db.messageThread.count()).resolves.toBe(MAX_NEW_CONVERSATIONS_PER_DAY);
      });

      it("still allows writing in existing conversations, and other people are unaffected", async () => {
        const people = await strangers(MAX_NEW_CONVERSATIONS_PER_DAY + 1);
        const threads = [];
        for (const person of people.slice(0, MAX_NEW_CONVERSATIONS_PER_DAY)) {
          threads.push(await as(alice).createThread({ initialMessage: "hi", participants: [person.id] }));
        }

        const first = people[0];
        await expect(
          as(alice).createThread({ initialMessage: "again", participants: [first?.id ?? ""] }),
        ).resolves.toMatchObject({ id: threads[0]?.id });
        await expect(
          as(alice).create({ content: "and again", threadId: threads[0]?.id ?? "" }),
        ).resolves.toBeDefined();
        await expect(
          as(bob).createThread({
            initialMessage: "hi",
            participants: [people[MAX_NEW_CONVERSATIONS_PER_DAY]?.id ?? ""],
          }),
        ).resolves.toBeDefined();
      });

      it("does not count refused recipients or messages into existing threads", async () => {
        const [person] = await strangers(1);
        await as(alice).createThread({ initialMessage: "one", participants: [person?.id ?? ""] });
        for (let i = 0; i < MAX_NEW_CONVERSATIONS_PER_DAY + 5; i++) {
          await as(alice).createThread({ initialMessage: "more", participants: [person?.id ?? ""] });
          await errorOf(as(alice).createThread({ initialMessage: "hi", participants: [carol.id] }));
          // Stay under the hourly limit on createThread calls as a whole.
          limiterClock.advance(5 * 60);
        }

        await expect(
          as(alice).createThread({ initialMessage: "hi", participants: [bob.id] }),
        ).resolves.toBeDefined();
      });

      it("starts again the next day", async () => {
        const people = await strangers(MAX_NEW_CONVERSATIONS_PER_DAY + 1);
        for (const person of people.slice(0, MAX_NEW_CONVERSATIONS_PER_DAY)) {
          await as(alice).createThread({ initialMessage: "hi", participants: [person.id] });
        }
        const last = people[MAX_NEW_CONVERSATIONS_PER_DAY]?.id ?? "";
        await expect(
          as(alice).createThread({ initialMessage: "hi", participants: [last] }),
        ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });

        limiterClock.advance(RateLimits.NEW_CONVERSATION_DAILY.windowSeconds);

        await expect(
          as(alice).createThread({ initialMessage: "hi", participants: [last] }),
        ).resolves.toBeDefined();
      });
    });

    it("is rate limited per user", async () => {
      await match(alice, bob);
      const limit = RateLimits.THREAD_CREATE.limit;
      for (let i = 0; i < limit; i++) {
        await as(alice).createThread({ initialMessage: `m${i}`, participants: [bob.id] });
      }
      await expect(
        as(alice).createThread({ initialMessage: "again", participants: [bob.id] }),
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    });
  });

  describe("create", () => {
    async function threadBetween(a: TestUser, b: TestUser) {
      await match(a, b);
      return as(a).createThread({ initialMessage: "hi", participants: [b.id] });
    }

    it("lets a participant send and returns the message", async () => {
      const thread = await threadBetween(alice, bob);
      const message = await as(bob).create({ content: " reply ", threadId: thread.id });
      expect(message).toMatchObject({ content: "reply", sender: { id: bob.id } });
    });

    it("answers FORBIDDEN, not a server error, to a non-participant", async () => {
      const thread = await threadBetween(alice, bob);

      await expect(
        as(carol).create({ content: "let me in", threadId: thread.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        as(carol).create({ content: "let me in", threadId: "no-such-thread" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("caps the message length", async () => {
      const thread = await threadBetween(alice, bob);
      await expect(
        as(alice).create({ content: "x".repeat(MAX_MESSAGE_LENGTH), threadId: thread.id }),
      ).resolves.toBeDefined();
      await expect(
        as(alice).create({ content: "x".repeat(MAX_MESSAGE_LENGTH + 1), threadId: thread.id }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("is rate limited per user", async () => {
      const thread = await threadBetween(alice, bob);
      const limit = RateLimits.MESSAGE_SEND.limit;
      for (let i = 0; i < limit; i++) {
        await as(bob).create({ content: `m${i}`, threadId: thread.id });
      }
      await expect(
        as(bob).create({ content: "one more", threadId: thread.id }),
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
      // Alice has her own allowance.
      await expect(as(alice).create({ content: "ok", threadId: thread.id })).resolves.toBeDefined();
    });
  });

  describe("soft-deleted messages", () => {
    it("are not returned as the latest message of a thread", async () => {
      await match(alice, bob);
      const thread = await as(alice).createThread({ initialMessage: "kept", participants: [bob.id] });
      const secret = await as(alice).create({ content: "deleted secret", threadId: thread.id });

      await as(alice).delete({ id: secret.id });

      await expect(
        as(bob).getLatestThreadMessage({ threadId: thread.id }),
      ).resolves.toMatchObject({ content: "kept" });
      const loaded = await as(bob).getThreadById({ threadId: thread.id });
      expect(loaded?.messages.map((m) => m.content)).toEqual(["kept"]);
      expect(loaded?._count.messages).toBe(1);
    });

    it("can only be deleted by their sender", async () => {
      await match(alice, bob);
      const thread = await as(alice).createThread({ initialMessage: "mine", participants: [bob.id] });
      const [message] = await testDb.db.message.findMany({ where: { threadId: thread.id } });

      await expect(as(bob).delete({ id: message?.id ?? "" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(testDb.db.message.count()).resolves.toBe(1);
    });
  });

  describe("recipient lookup", () => {
    it("lists discoverable members and people the caller is related to", async () => {
      // Bob is a discoverable stranger; Carol is hidden but matched.
      await match(alice, carol);

      const results = await as(alice).getPotentialRecipients({ query: "o" });

      // Related people first, then discoverable ones.
      expect(results.map((user) => user.id)).toEqual([carol.id, bob.id]);
    });

    it("never returns a non-discoverable stranger, or the caller", async () => {
      await expect(as(alice).getPotentialRecipients({ query: "Carol" })).resolves.toEqual([]);
      await expect(as(alice).getPotentialRecipients({ query: "Alice" })).resolves.toEqual([]);
    });

    it("lists a hidden member for someone with an active booking, not a declined one", async () => {
      const booking = await book(alice, carol);
      await expect(as(alice).getPotentialRecipients({ query: "Carol" })).resolves.toMatchObject([
        { id: carol.id },
      ]);

      await testDb.db.booking.update({ data: { status: "declined" }, where: { id: booking.id } });
      await expect(as(alice).getPotentialRecipients({ query: "Carol" })).resolves.toEqual([]);
    });

    it("caps the number of results and does not repeat anyone", async () => {
      const many = await Promise.all(
        Array.from({ length: MAX_RECIPIENT_RESULTS + 5 }, (_, i) =>
          createTestUser(testDb.db, { firstName: `Zed${String(i).padStart(2, "0")}`, isDiscoverable: true }),
        ),
      );
      // One of them is also related.
      const related = many[MAX_RECIPIENT_RESULTS + 4];
      if (!related) throw new Error("fixture missing");
      await match(alice, related);

      const results = await as(alice).getPotentialRecipients({ query: "Zed" });

      expect(results).toHaveLength(MAX_RECIPIENT_RESULTS);
      expect(new Set(results.map((user) => user.id)).size).toBe(MAX_RECIPIENT_RESULTS);
      expect(results[0]?.id).toBe(related.id);
    });

    it("returns only display fields", async () => {
      const [result] = await as(alice).getPotentialRecipients({ query: "Bob" });
      expect(Object.keys(result ?? {}).sort()).toEqual([
        "firstName",
        "id",
        "lastName",
        "photographer",
        "profilePic",
      ]);
    });

    it("resolves a deep link for someone the caller may message", async () => {
      await expect(as(alice).getRecipientById({ userId: bob.id })).resolves.toMatchObject({
        id: bob.id,
      });
      await expect(as(alice).getRecipientById({ userId: alice.id })).resolves.toBeNull();

      await match(alice, carol);
      await expect(as(alice).getRecipientById({ userId: carol.id })).resolves.toMatchObject({
        id: carol.id,
      });
    });

    it("puts the reason in error.data.reason on the wire", async () => {
      const input = encodeURIComponent(JSON.stringify({ json: { userId: carol.id } }));
      const response = await fetchRequestHandler({
        createContext: () => ({
          cloudinaryClient: null,
          db: testDb.db,
          headers: new Headers(),
          session: { expires: new Date(Date.now() + 60_000).toISOString(), user: alice },
        }),
        endpoint: "/api/trpc",
        req: new Request(`http://localhost/api/trpc/getRecipientById?input=${input}`),
        router: messageRouter as AnyTRPCRouter,
      });

      expect(response.status).toBe(403);
      const body: unknown = await response.json();
      expect(body).toMatchObject({
        error: { json: { data: { code: "FORBIDDEN", reason: "recipient_not_messageable" } } },
      });
      // What the client helper reads from a TRPCClientError.
      const data = (body as { error: { json: { data: unknown } } }).error.json.data;
      expect(getErrorReason({ data })).toBe(ErrorReason.RECIPIENT_NOT_MESSAGEABLE);
      expect(getErrorReason({ data: { reason: "something-else" } })).toBeNull();
      expect(getErrorReason(new Error("plain"))).toBeNull();
    });

    it("answers a deep link to a hidden stranger and to nobody identically, with a reason", async () => {
      const hidden = await errorOf(as(alice).getRecipientById({ userId: carol.id }));
      const missing = await errorOf(as(alice).getRecipientById({ userId: "no-such-user" }));

      for (const error of [hidden, missing]) {
        expect(error).toMatchObject({ code: "FORBIDDEN" });
        expect(reasonOf(error)).toBe(ErrorReason.RECIPIENT_NOT_MESSAGEABLE);
      }
      expect((missing as Error).message).toBe((hidden as Error).message);
    });
  });

  describe("thread access", () => {
    it("lists only the caller's threads, most recently active first", async () => {
      await match(alice, bob);
      await match(alice, carol);
      const withBob = await as(alice).createThread({ initialMessage: "b", participants: [bob.id] });
      const withCarol = await as(alice).createThread({ initialMessage: "c", participants: [carol.id] });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await as(bob).create({ content: "newest", threadId: withBob.id });

      const aliceThreads = await as(alice).getThreadsByUserId();
      expect(aliceThreads.map((t) => t.id)).toEqual([withBob.id, withCarol.id]);
      expect((await as(carol).getThreadsByUserId()).map((t) => t.id)).toEqual([withCarol.id]);

      const firstPage = await as(alice).getThreadsByUserId({ limit: 1 });
      const secondPage = await as(alice).getThreadsByUserId({ cursor: firstPage[0]?.id, limit: 1 });
      expect([firstPage[0]?.id, secondPage[0]?.id]).toEqual([withBob.id, withCarol.id]);
    });

    it("pages through conversations with nextCursor, newest activity first", async () => {
      const others = [];
      for (let i = 0; i < 5; i++) {
        const other = await createTestUser(testDb.db, { isDiscoverable: true });
        const thread = await as(alice).createThread({ initialMessage: `t${i}`, participants: [other.id] });
        // Distinct, increasing activity times.
        await testDb.raw.messageThread.update({
          data: { updatedAt: new Date(Date.UTC(2030, 0, 1, 0, i)) },
          where: { id: thread.id },
        });
        others.push(thread.id);
      }
      const newestFirst = [...others].reverse();

      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await as(alice).getThreadsPage({ cursor, limit: 2 });
        seen.push(...page.items.map((thread) => thread.id));
        cursor = page.nextCursor ?? undefined;
        pages += 1;
      } while (cursor);

      expect(seen).toEqual(newestFirst);
      expect(pages).toBe(3);
      // The capped legacy list returns the same, newest, slice.
      expect((await as(alice).getThreadsByUserId({ limit: 2 })).map((t) => t.id)).toEqual(
        newestFirst.slice(0, 2),
      );
      // A page that ends exactly at the end has no next cursor.
      await expect(as(alice).getThreadsPage({ limit: 5 })).resolves.toMatchObject({ nextCursor: null });
    });

    it("does not show a thread to someone outside it", async () => {
      await match(alice, bob);
      const thread = await as(alice).createThread({ initialMessage: "private", participants: [bob.id] });

      await expect(as(carol).getThreadById({ threadId: thread.id })).resolves.toBeNull();
      await expect(as(carol).getLatestThreadMessage({ threadId: thread.id })).resolves.toBeNull();
      await expect(
        as(carol).getThreadByParticipants({ participants: [alice.id, bob.id] }),
      ).resolves.toBeNull();
    });
  });
  describe("daily cap counts people, not threads", () => {
    const strangers = (count: number) =>
      Promise.all(
        Array.from({ length: count }, (_, i) =>
          createTestUser(testDb.db, { firstName: `Group${i}`, isDiscoverable: true }),
        ),
      );

    it("counts a new group thread once per recipient", async () => {
      const people = await strangers(MAX_NEW_CONVERSATIONS_PER_DAY + 1);
      const ids = people.map((person) => person.id);
      // Two groups of nine: 18 of the 20 people allowed today.
      await as(alice).createThread({ initialMessage: "team a", participants: ids.slice(0, 9) });
      await as(alice).createThread({ initialMessage: "team b", participants: ids.slice(9, 18) });

      // Two more people fit; a third does not.
      await as(alice).createThread({ initialMessage: "hi", participants: [ids[18] ?? ""] });
      await as(alice).createThread({ initialMessage: "hi", participants: [ids[19] ?? ""] });
      const error = await errorOf(
        as(alice).createThread({ initialMessage: "hi", participants: [ids[20] ?? ""] }),
      );

      expect(error).toMatchObject({ code: "TOO_MANY_REQUESTS" });
      expect(reasonOf(error)).toBe(ErrorReason.NEW_CONVERSATION_LIMIT);
      expect(await testDb.db.messageThread.count()).toBe(4);
    });

    it("a group that does not fit is refused whole, without using up what was left", async () => {
      const people = await strangers(2);
      const ids = people.map((person) => person.id);
      // Alice has already reached all but two of the people she may today.
      await spendRateLimit(
        testDb.db,
        RateLimits.NEW_CONVERSATION_DAILY,
        `user:${alice.id}`,
        MAX_NEW_CONVERSATIONS_PER_DAY - 2,
      );

      // Two places left; a group of three would need three.
      const error = await errorOf(
        as(alice).createThread({
          initialMessage: "all of you",
          participants: [bob.id, ids.at(-1) ?? "", ids.at(-2) ?? ""],
        }),
      );
      expect(reasonOf(error)).toBe(ErrorReason.NEW_CONVERSATION_LIMIT);
      expect(await testDb.db.messageThread.count()).toBe(0);

      // The refusal cost nothing: the two places are still there.
      await as(alice).createThread({ initialMessage: "hi", participants: [ids.at(-1) ?? ""] });
      await as(alice).createThread({ initialMessage: "hi", participants: [ids.at(-2) ?? ""] });
      await expect(
        as(alice).createThread({ initialMessage: "hi", participants: [bob.id] }),
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    });
  });

  describe("thread activity time", () => {
    it("moves with the message insert itself (database trigger), for any writer", async () => {
      const thread = await as(alice).createThread({ initialMessage: "first", participants: [bob.id] });
      const at = new Date("2031-03-04T05:06:07.890Z");

      // Not through the router: a bare insert, as any code path would do.
      await testDb.raw.message.create({
        data: { content: "direct", createdAt: at, senderId: bob.id, threadId: thread.id },
      });

      expect((await testDb.raw.messageThread.findUniqueOrThrow({ where: { id: thread.id } })).updatedAt).toEqual(at);
    });

    it("a reply brings an older conversation back to the top", async () => {
      const older = await as(alice).createThread({ initialMessage: "older", participants: [bob.id] });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const dave = await createTestUser(testDb.db, { isDiscoverable: true });
      const newer = await as(alice).createThread({ initialMessage: "newer", participants: [dave.id] });
      expect((await as(alice).getThreadsByUserId()).map((t) => t.id)).toEqual([newer.id, older.id]);

      await new Promise((resolve) => setTimeout(resolve, 5));
      await as(bob).create({ content: "reply", threadId: older.id });

      expect((await as(alice).getThreadsByUserId()).map((t) => t.id)).toEqual([older.id, newer.id]);
    });
  });

  describe("read state", () => {
    const unreadOf = async (user: TestUser, threadId: string) =>
      (await as(user).getThreadsByUserId()).find((thread) => thread.id === threadId);

    /** Later than anything sent so far (read state has millisecond resolution). */
    const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

    it("counts messages from others as unread until the thread is marked read", async () => {
      const thread = await as(alice).createThread({ initialMessage: "one", participants: [bob.id] });
      await as(alice).create({ content: "two", threadId: thread.id });

      // The sender has nothing unread; the recipient has both messages.
      expect(await unreadOf(alice, thread.id)).toMatchObject({ hasUnread: false, unreadCount: 0 });
      expect(await unreadOf(bob, thread.id)).toMatchObject({ hasUnread: true, unreadCount: 2 });
      expect(await as(bob).getUnreadCount()).toEqual({ unreadMessages: 2, unreadThreads: 1 });
      expect(await as(alice).getUnreadCount()).toEqual({ unreadMessages: 0, unreadThreads: 0 });

      await tick();
      const marked = await as(bob).markThreadRead({ threadId: thread.id });

      expect(marked.threadId).toBe(thread.id);
      expect(await unreadOf(bob, thread.id)).toMatchObject({ hasUnread: false, unreadCount: 0 });
      expect(await as(bob).getUnreadCount()).toEqual({ unreadMessages: 0, unreadThreads: 0 });

      // A later message is unread again, and only that one.
      await tick();
      await as(alice).create({ content: "three", threadId: thread.id });
      expect(await unreadOf(bob, thread.id)).toMatchObject({ hasUnread: true, unreadCount: 1 });
    });

    it("keeps read state per participant in a group thread", async () => {
      const dave = await createTestUser(testDb.db, { isDiscoverable: true });
      const thread = await as(alice).createThread({ initialMessage: "hello both", participants: [bob.id, dave.id] });
      await tick();

      await as(bob).markThreadRead({ threadId: thread.id });

      expect(await unreadOf(bob, thread.id)).toMatchObject({ unreadCount: 0 });
      expect(await unreadOf(dave, thread.id)).toMatchObject({ unreadCount: 1 });

      // Bob's reply is unread for Alice and Dave, not for Bob.
      await tick();
      await as(bob).create({ content: "hi", threadId: thread.id });
      expect(await unreadOf(alice, thread.id)).toMatchObject({ unreadCount: 1 });
      expect(await unreadOf(dave, thread.id)).toMatchObject({ unreadCount: 2 });
      expect(await unreadOf(bob, thread.id)).toMatchObject({ unreadCount: 0 });
    });

    it("sending in a thread marks it read for the sender", async () => {
      const thread = await as(alice).createThread({ initialMessage: "question", participants: [bob.id] });
      await tick();

      await as(bob).create({ content: "answer", threadId: thread.id });

      expect(await unreadOf(bob, thread.id)).toMatchObject({ unreadCount: 0 });
    });

    it("does not count deleted messages", async () => {
      const thread = await as(alice).createThread({ initialMessage: "oops", participants: [bob.id] });
      const message = await testDb.db.message.findFirstOrThrow({ where: { threadId: thread.id } });

      await as(alice).delete({ id: message.id });

      expect(await unreadOf(bob, thread.id)).toMatchObject({ hasUnread: false, unreadCount: 0 });
      expect(await as(bob).getUnreadCount()).toEqual({ unreadMessages: 0, unreadThreads: 0 });
    });

    it("totals across conversations and puts unread info on getThreadsPage", async () => {
      const dave = await createTestUser(testDb.db, { isDiscoverable: true });
      const fromAlice = await as(alice).createThread({ initialMessage: "a1", participants: [bob.id] });
      await as(alice).create({ content: "a2", threadId: fromAlice.id });
      const fromDave = await as(dave).createThread({ initialMessage: "d1", participants: [bob.id] });

      expect(await as(bob).getUnreadCount()).toEqual({ unreadMessages: 3, unreadThreads: 2 });
      const page = await as(bob).getThreadsPage();
      expect(Object.fromEntries(page.items.map((thread) => [thread.id, thread.unreadCount]))).toEqual({
        [fromAlice.id]: 2,
        [fromDave.id]: 1,
      });
      expect(page.items.every((thread) => thread.hasUnread)).toBe(true);
    });

    it("only lets a participant mark a thread read, and only changes their own state", async () => {
      const thread = await as(alice).createThread({ initialMessage: "private", participants: [bob.id] });

      await expect(as(carol).markThreadRead({ threadId: thread.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(as(carol).markThreadRead({ threadId: "missing" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(anonymous().markThreadRead({ threadId: thread.id })).rejects.toMatchObject({ code: "UNAUTHORIZED" });

      expect(await testDb.raw.threadRead.count({ where: { userId: carol.id } })).toBe(0);
      expect(await unreadOf(bob, thread.id)).toMatchObject({ unreadCount: 1 });
    });

    it("marking read twice at once is fine, and it is rate limited", async () => {
      const thread = await as(alice).createThread({ initialMessage: "hey", participants: [bob.id] });

      await Promise.all([
        as(bob).markThreadRead({ threadId: thread.id }),
        as(bob).markThreadRead({ threadId: thread.id }),
      ]);
      expect(await testDb.raw.threadRead.count({ where: { threadId: thread.id, userId: bob.id } })).toBe(1);

      await spendRateLimit(testDb.db, RateLimits.MESSAGE_MARK_READ, `user:${bob.id}`, RateLimits.MESSAGE_MARK_READ.limit - 2);
      await expect(as(bob).markThreadRead({ threadId: thread.id })).rejects.toMatchObject({
        code: "TOO_MANY_REQUESTS",
      });
    });

    it("counts a full page of conversations in one grouped query, within D1's parameter limit", async () => {
      // 50 conversations with one unread message each, written directly:
      // what is under test is the read side.
      for (let i = 0; i < 50; i++) {
        await testDb.raw.messageThread.create({
          data: {
            messages: { create: { content: "hi bob", senderId: alice.id } },
            participantKey: `page-test-${i}`,
            participants: { connect: [{ id: alice.id }, { id: bob.id }] },
          },
        });
      }
      const queryRaw = vi.spyOn(testDb.db, "$queryRaw");

      const page = await as(bob).getThreadsPage({ limit: 50 });

      expect(page.items).toHaveLength(50);
      expect(page.items.every((thread) => thread.unreadCount === 1)).toBe(true);
      const unreadQueries = queryRaw.mock.calls
        .map(([query]): unknown => query)
        .filter(isSqlObject)
        .filter((query) => query.sql.includes("ThreadRead"));
      expect(unreadQueries).toHaveLength(1);
      expect(unreadQueries[0]?.values.length).toBeLessThanOrEqual(100);
      queryRaw.mockRestore();
    });

    it("does not expose the dead isRead column on new messages", async () => {
      const thread = await as(alice).createThread({ initialMessage: "one", participants: [bob.id] });

      const message = await as(alice).create({ content: "two", threadId: thread.id });

      expect(message).not.toHaveProperty("isRead");
    });
  });
});
