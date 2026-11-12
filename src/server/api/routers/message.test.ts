import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { threadParticipantKey } from "~/server/_db/messaging";
import { RateLimits } from "~/server/_utils/rateLimit";
import { createDbCaller } from "~/test/helpers/dbCaller";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));

import { MAX_MESSAGE_LENGTH, messageRouter } from "./message";

type TestUser = { email: string; id: string };

describe("messageRouter against SQLite", () => {
  let testDb: TestDb;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;

  const as = (user: TestUser) => createDbCaller(messageRouter, testDb.db, { user });
  const anonymous = () => createDbCaller(messageRouter, testDb.db);

  /** Gives two users the relationship that allows a first message. */
  async function match(a: TestUser, b: TestUser) {
    const [user1Id, user2Id] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    await testDb.db.match.create({ data: { user1Id, user2Id } });
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

    it("refuses a first message to someone the caller has no relationship with", async () => {
      await expect(
        as(alice).createThread({ initialMessage: "hi", participants: [bob.id] }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      await expect(testDb.db.messageThread.count()).resolves.toBe(0);
      await expect(testDb.raw.message.count()).resolves.toBe(0);
    });

    it("answers the same for a user id that does not exist", async () => {
      const unrelated = await as(alice)
        .createThread({ initialMessage: "hi", participants: [bob.id] })
        .catch((e: unknown) => e);
      const missing = await as(alice)
        .createThread({ initialMessage: "hi", participants: ["no-such-user"] })
        .catch((e: unknown) => e);

      expect(missing).toMatchObject({ code: "FORBIDDEN" });
      expect((missing as Error).message).toBe((unrelated as Error).message);
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

    it("allows a first message when there is a booking between the two", async () => {
      const photographer = await testDb.db.photographer.create({
        data: { companyName: "Co", location: "Austin", name: "Bob", userId: bob.id },
      });
      const event = await testDb.db.event.create({
        data: { date: new Date("2031-01-01"), location: "Austin", photographerId: photographer.id, title: "Wedding" },
      });
      await testDb.db.booking.create({
        data: { applicantId: alice.id, eventId: event.id, ownerId: bob.id },
      });

      // Either side may start the conversation.
      await expect(
        as(bob).createThread({ initialMessage: "thanks for applying", participants: [alice.id] }),
      ).resolves.toMatchObject({ id: expect.any(String) as string });
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
    it("lists only people the caller has a relationship with", async () => {
      // Bob is discoverable but unrelated; Carol is hidden but matched.
      await match(alice, carol);

      const results = await as(alice).getPotentialRecipients({ query: "o" });

      expect(results.map((user) => user.id)).toEqual([carol.id]);
    });

    it("never returns a non-discoverable stranger", async () => {
      const results = await as(alice).getPotentialRecipients({ query: "Carol" });
      expect(results).toEqual([]);
    });

    it("returns only display fields", async () => {
      await match(alice, bob);
      const [result] = await as(alice).getPotentialRecipients({ query: "Bob" });
      expect(Object.keys(result ?? {}).sort()).toEqual([
        "firstName",
        "id",
        "lastName",
        "photographer",
        "profilePic",
      ]);
    });

    it("resolves a deep link only for someone the caller may message", async () => {
      await expect(as(alice).getRecipientById({ userId: bob.id })).resolves.toBeNull();
      await expect(as(alice).getRecipientById({ userId: alice.id })).resolves.toBeNull();

      await match(alice, bob);
      await expect(as(alice).getRecipientById({ userId: bob.id })).resolves.toMatchObject({
        id: bob.id,
      });
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
});
