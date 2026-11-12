import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

import { withSoftDeleteFilter } from "./softDelete";

describe("withSoftDeleteFilter", () => {
  it("adds isDeleted: false when the query does not mention it", () => {
    expect(withSoftDeleteFilter({ where: { id: "a" } })).toEqual({
      where: { id: "a", isDeleted: false },
    });
    expect(withSoftDeleteFilter({})).toEqual({ where: { isDeleted: false } });
  });

  it("leaves a query that filters on isDeleted itself alone", () => {
    const args = { where: { id: "a", isDeleted: true } };
    expect(withSoftDeleteFilter(args)).toBe(args);
  });
});

describe("soft-delete extension against SQLite", () => {
  let testDb: TestDb;
  let eventId: string;
  let deletedEventId: string;
  let threadId: string;
  let userId: string;

  beforeAll(async () => {
    testDb = await createTestDb();
    const { db } = testDb;

    const user = await createTestUser(db);
    userId = user.id;
    const photographer = await db.photographer.create({
      data: { companyName: "Co", location: "Austin, TX", name: "P", userId },
    });

    const live = await db.event.create({
      data: {
        date: new Date("2030-01-01"),
        location: "Austin, TX",
        photographerId: photographer.id,
        title: "Live",
      },
    });
    const deleted = await db.event.create({
      data: {
        date: new Date("2030-01-02"),
        isDeleted: true,
        location: "Austin, TX",
        photographerId: photographer.id,
        title: "Deleted",
      },
    });
    eventId = live.id;
    deletedEventId = deleted.id;

    await db.comment.create({ data: { content: "kept", eventId, userId } });
    await db.comment.create({
      data: { content: "removed", eventId, isDeleted: true, userId },
    });

    const thread = await db.messageThread.create({
      data: { participants: { connect: { id: userId } } },
    });
    threadId = thread.id;
    await db.message.create({
      data: {
        content: "first",
        createdAt: new Date("2030-01-01T00:00:00Z"),
        senderId: userId,
        threadId,
      },
    });
    await db.message.create({
      data: {
        content: "deleted secret",
        createdAt: new Date("2030-01-02T00:00:00Z"),
        isDeleted: true,
        senderId: userId,
        threadId,
      },
    });
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("findFirst skips deleted rows (latest thread message)", async () => {
    const latest = await testDb.db.message.findFirst({
      orderBy: { createdAt: "desc" },
      where: { threadId },
    });
    expect(latest?.content).toBe("first");
  });

  it("findUnique and findUniqueOrThrow do not return deleted rows", async () => {
    await expect(
      testDb.db.event.findUnique({ where: { id: deletedEventId } }),
    ).resolves.toBeNull();
    await expect(
      testDb.db.event.findUniqueOrThrow({ where: { id: deletedEventId } }),
    ).rejects.toThrow();
    await expect(
      testDb.db.event.findUnique({ where: { id: eventId } }),
    ).resolves.toMatchObject({ title: "Live" });
  });

  it("findFirstOrThrow does not return deleted rows", async () => {
    await expect(
      testDb.db.event.findFirstOrThrow({ where: { id: deletedEventId } }),
    ).rejects.toThrow();
  });

  it("findMany, count, aggregate and groupBy exclude deleted rows", async () => {
    const { db } = testDb;
    await expect(db.event.findMany()).resolves.toHaveLength(1);
    await expect(db.comment.count({ where: { eventId } })).resolves.toBe(1);
    await expect(db.message.count()).resolves.toBe(1);

    const aggregate = await db.event.aggregate({ _count: { _all: true } });
    expect(aggregate._count._all).toBe(1);

    const groups = await db.comment.groupBy({
      _count: { _all: true },
      by: ["eventId"],
    });
    expect(groups).toEqual([{ _count: { _all: 1 }, eventId }]);
  });

  it("returns deleted rows only to a query that asks for them", async () => {
    const { db } = testDb;
    await expect(
      db.event.findUnique({ where: { id: deletedEventId, isDeleted: true } }),
    ).resolves.toMatchObject({ title: "Deleted" });
    await expect(
      db.comment.count({ where: { eventId, isDeleted: true } }),
    ).resolves.toBe(1);
  });

  it("hides deleted accounts and their profiles, but relations still load them", async () => {
    const { db } = testDb;
    const gone = await createTestUser(db);
    const photographer = await db.photographer.create({
      data: { companyName: "", isDeleted: true, location: "", name: "Deleted member", userId: gone.id },
    });
    await db.user.update({ data: { isDeleted: true }, where: { id: gone.id } });

    await expect(db.user.findUnique({ where: { id: gone.id } })).resolves.toBeNull();
    await expect(db.user.findUnique({ where: { email: gone.email } })).resolves.toBeNull();
    await expect(db.photographer.findFirst({ where: { userId: gone.id } })).resolves.toBeNull();
    await expect(db.user.count({ where: { id: gone.id, isDeleted: true } })).resolves.toBe(1);

    const loaded = await db.photographer.findMany({ select: { id: true } });
    expect(loaded.map((row) => row.id)).not.toContain(photographer.id);
    // Through a relation the anonymised row is still there.
    const viaAccount = await testDb.raw.photographer.findUnique({
      include: { user: true },
      where: { id: photographer.id },
    });
    expect(viaAccount?.user.id).toBe(gone.id);
  });
});
