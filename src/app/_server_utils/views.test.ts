import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifiedViewSource, viewerKey } from "~/server/_lib/viewCounter";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

const request = vi.hoisted((): { db: unknown; headers: Headers } => ({ db: null, headers: new Headers() }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("~/_lib/site", () => ({ SITE_URL: "https://myiso.app" }));
vi.mock("~/server/db", () => ({
  get db() {
    return request.db;
  },
}));

import { viewBeaconProps, viewSource } from "./views";

const NOW = new Date("2030-06-15T12:00:00Z");

describe("viewSource", () => {
  it("classifies the page request's referrer against the configured origin only", async () => {
    request.headers = new Headers({ referer: "https://myiso.app/app/search?q=olive" });
    expect(await viewSource()).toBe("search");

    // A forwarded host claiming to be this site changes nothing.
    request.headers = new Headers({ "referer": "https://preview.example/app/search", "x-forwarded-host": "preview.example" });
    expect(await viewSource()).toBe("external");

    request.headers = new Headers();
    expect(await viewSource()).toBe("direct");
  });
});

describe("viewBeaconProps", () => {
  let testDb: TestDb;
  let owner: { id: string };
  let viewer: { id: string };

  beforeEach(async () => {
    testDb = await createTestDb();
    request.db = testDb.db;
    owner = await createTestUser(testDb.db);
    viewer = await createTestUser(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  const people = () => ({ ownerId: owner.id, viewerId: viewer.id });

  it("gives the beacon the source with a token the counter accepts, for this target and viewer only", async () => {
    request.headers = new Headers({ "cf-connecting-ip": "203.0.113.9", "referer": "https://myiso.app/app/events/e1" });
    const target = { id: owner.id, kind: "profile" } as const;
    const props = await viewBeaconProps(target, people(), NOW);
    expect(props).toMatchObject({ id: owner.id, kind: "profile", source: "event" });
    const me = viewerKey(viewer.id, "203.0.113.9");
    expect(await verifiedViewSource(target, "event", props.token, me, NOW)).toBe("event");
    expect(await verifiedViewSource({ id: viewer.id, kind: "profile" }, "event", props.token, me, NOW)).toBe("other");
    expect(await verifiedViewSource(target, "event", props.token, viewerKey(owner.id, "203.0.113.9"), NOW)).toBe("other");
  });

  it("signed out, binds the token to the client address", async () => {
    request.headers = new Headers({ "cf-connecting-ip": "203.0.113.9", "referer": "https://myiso.app/app/search" });
    const target = { id: owner.id, kind: "profile" } as const;
    const props = await viewBeaconProps(target, { ownerId: owner.id, viewerId: null }, NOW);
    expect(await verifiedViewSource(target, "search", props.token, viewerKey(null, "203.0.113.9"), NOW)).toBe("search");
    expect(await verifiedViewSource(target, "search", props.token, viewerKey(null, "203.0.113.10"), NOW)).toBe("other");
  });

  describe("a Messages referrer", () => {
    const fromMessages = () => new Headers({ referer: "https://myiso.app/app/messages/t1" });

    it("is Other when the viewer shares no thread with the owner (a forged Referer)", async () => {
      request.headers = fromMessages();
      const query = vi.spyOn(testDb.db, "$queryRaw");
      expect((await viewBeaconProps({ id: owner.id, kind: "profile" }, people(), NOW)).source).toBe("other");
      expect(query).toHaveBeenCalledTimes(1);
      // A thread between the viewer and someone else does not count.
      const third = await createTestUser(testDb.db);
      await testDb.db.messageThread.create({ data: { participants: { connect: [{ id: viewer.id }, { id: third.id }] } } });
      expect((await viewBeaconProps({ id: owner.id, kind: "profile" }, people(), NOW)).source).toBe("other");
      // Signed out, or the owner themselves, it is never Messages.
      expect((await viewBeaconProps({ id: owner.id, kind: "profile" }, { ownerId: owner.id, viewerId: null }, NOW)).source).toBe("other");
      expect((await viewBeaconProps({ id: owner.id, kind: "profile" }, { ownerId: owner.id, viewerId: owner.id }, NOW)).source).toBe("other");
    });

    it("is Messages when the viewer really shares a thread with the owner (an event's owner for an event)", async () => {
      request.headers = fromMessages();
      await testDb.db.messageThread.create({ data: { participants: { connect: [{ id: viewer.id }, { id: owner.id }] } } });
      expect((await viewBeaconProps({ id: owner.id, kind: "profile" }, people(), NOW)).source).toBe("messages");
      expect((await viewBeaconProps({ id: "event-1", kind: "event" }, people(), NOW)).source).toBe("messages");
    });

    it("runs no query for any other source", async () => {
      request.headers = new Headers({ referer: "https://myiso.app/app/search" });
      const query = vi.spyOn(testDb.db, "$queryRaw");
      expect((await viewBeaconProps({ id: owner.id, kind: "profile" }, people(), NOW)).source).toBe("search");
      expect(query).not.toHaveBeenCalled();
    });
  });
});
