import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { image, seedAccount } from "~/test/helpers/accountFixture";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

import { type AccountExport, buildAccountExport, EXPORT_COVERAGE, EXPORT_FORMAT, EXPORT_PAGE } from "./exportData";

const schema = readFileSync(path.resolve(__dirname, "../../../../prisma/schema.prisma"), "utf8");

/** Model name -> its body, from prisma/schema.prisma. */
const models = new Map(
  [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((match) => [match[1] ?? "", match[2] ?? ""]),
);

/** Models with a field typed User: rows that are about a member by construction. */
const referencesUser = [...models].filter(([, body]) => /^\s+\w+\s+User[?[\]]*\s/m.test(body)).map(([name]) => name);

/** Reads `a.b` from the export. */
function at(data: AccountExport, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | null)?.[part], data);
}

describe("EXPORT_COVERAGE", () => {
  it("classifies every model in the schema, and nothing else", () => {
    // A new model fails here until it is exported or excluded with a reason.
    expect(Object.keys(EXPORT_COVERAGE).sort()).toEqual([...models.keys()].sort());
  });

  it("exports every model that references a User", () => {
    expect(referencesUser.length).toBeGreaterThan(15);
    const notExported = referencesUser.filter((name) => {
      const entry = EXPORT_COVERAGE[name];
      return !entry || !("exportedAs" in entry);
    });
    // Session is the one exception: secret tokens, and the table is unused
    // with JWT sessions. Its reason is in EXPORT_COVERAGE.
    expect(notExported).toEqual(["Session"]);
  });

  it("gives a reason for every exclusion", () => {
    for (const [name, entry] of Object.entries(EXPORT_COVERAGE)) {
      if ("excluded" in entry) expect(entry.excluded.length, name).toBeGreaterThan(20);
    }
  });
});

describe("buildAccountExport", () => {
  let testDb: TestDb;
  let seeded: Awaited<ReturnType<typeof seedAccount>>;
  let data: AccountExport;
  const now = new Date("2026-11-12T12:00:00Z");

  beforeAll(async () => {
    testDb = await createTestDb();
    seeded = await seedAccount(testDb.db);
    data = await buildAccountExport(testDb.db, seeded.member.id, {
      consent: { choice: "analytics", optInRegion: true },
      now,
    });
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("has a non-empty section for every exported model", () => {
    for (const [name, entry] of Object.entries(EXPORT_COVERAGE)) {
      if (!("exportedAs" in entry)) continue;
      const value = at(data, entry.exportedAs);
      expect(value, `${name} -> ${entry.exportedAs}`).toBeTruthy();
      if (Array.isArray(value)) expect(value.length, `${name} -> ${entry.exportedAs}`).toBeGreaterThan(0);
    }
  });

  it("describes itself, the account and the consent in effect", () => {
    expect(data).toMatchObject({
      account: { email: seeded.member.email, firstName: "Ann", phone: "+15125550100", seekingTypes: ["wedding"] },
      consent: { choice: "analytics", optInRegion: true },
      format: EXPORT_FORMAT,
      generatedAt: now.toISOString(),
      profile: { bio: "Wedding photographer.", name: "Ann Lee" },
      subscription: { plan: "standard", status: "active" },
    });
    expect(data.account.invitedBy?.firstName).toBe("Bea");
  });

  it("lists every uploaded image, removed ones included", () => {
    const id = seeded.member.id;
    expect([...data.images].sort()).toEqual(
      [
        image(`${id}/profile/me`),
        image(`${id}/profile/avatar`),
        image(`${id}/portfolio/one`),
        image(`${id}/portfolio/removed`),
        image(`app/${seeded.photographer.id}/events/cover`),
      ].sort(),
    );
    expect(data.portfolio.map((row) => row.tags)).toContainEqual(["wedding"]);
  });

  it("holds the member's own messages only, and the people in their threads", () => {
    expect(data.messages.sent.map((message) => message.content)).toEqual(["Hi Bea!"]);
    expect(JSON.stringify(data)).not.toContain("Hi Ann!");
    expect(data.messages.threads[0]?.participants.map((p) => p.firstName).sort()).toEqual(["Ann", "Bea"]);
  });

  it("never includes secrets: sign-in tokens or provider tokens", () => {
    const text = JSON.stringify(data);
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("123456");
    expect(text).not.toContain(`session-${seeded.member.id}`);
    expect(data.signInMethods).toEqual([{ provider: "google", type: "oidc" }]);
  });

  it("covers both sides of bookings and reviews, and the discover history", () => {
    expect(data.bookings.asApplicant[0]).toMatchObject({ notes: "I shoot on Sony.", status: "applied" });
    expect(data.bookings.asOwner[0]).toMatchObject({ applicant: { firstName: "Bea" }, status: "accepted" });
    expect(data.reviews.written[0]).toMatchObject({ title: "Great to work with" });
    expect(data.reviews.received[0]).toMatchObject({ description: "Ann was great." });
    expect(data.discover.matches[0]).toMatchObject({ icebreakers: ["Ask about film"] });
    expect(data.discover.swipes).toHaveLength(1);
  });

  it("works for a member with nothing but an account", async () => {
    const bare = await createTestUser(testDb.db);
    await testDb.db.user.update({ data: { seekingTypes: "not json" }, where: { id: bare.id } });
    const empty = await buildAccountExport(testDb.db, bare.id, { consent: { choice: "unknown", optInRegion: false } });
    expect(empty).toMatchObject({
      account: { seekingTypes: "not json" },
      events: [],
      images: [],
      portfolio: [],
      profile: null,
      reviews: { received: [] },
      subscription: null,
      waitlist: null,
    });
  });

  it("reads more rows than one query may bind, and caps the lists that grow without bound", async () => {
    const member = await createTestUser(testDb.db, { firstName: "Many", lastName: "Rows" });
    const other = await createTestUser(testDb.db);
    const photographer = await testDb.db.photographer.create({
      data: { companyName: "", location: "", name: "Many", userId: member.id },
    });
    const count = EXPORT_PAGE + 20;
    for (let i = 0; i < count; i++) {
      const thread = await testDb.db.messageThread.create({
        data: { participants: { connect: [{ id: member.id }, { id: other.id }] } },
      });
      const event = await testDb.db.event.create({
        data: { date: new Date(), location: "X", photographerId: photographer.id, title: `E${i}` },
      });
      await testDb.db.booking.create({ data: { applicantId: other.id, eventId: event.id, ownerId: member.id } });
      if (i < 7) {
        await testDb.db.message.create({
          data: { content: `m${i}`, createdAt: new Date(Date.UTC(2026, 0, 1 + i)), senderId: member.id, threadId: thread.id },
        });
        await testDb.db.notification.create({
          data: { body: `n${i}`, createdAt: new Date(Date.UTC(2026, 0, 1 + i)), recipientId: member.id, title: "t", type: "x" },
        });
      }
    }

    const data = await buildAccountExport(testDb.db, member.id, {
      consent: { choice: "unknown", optInRegion: false },
      limits: { notifications: 3, sentMessages: 5 },
    });

    expect(data.messages.threads).toHaveLength(count);
    expect(data.bookings.asOwner).toHaveLength(count);
    expect(new Set(data.bookings.asOwner.map((booking) => booking.id)).size).toBe(count);
    // The latest five, oldest first, and marked as cut.
    expect(data.messages.sent.map((message) => message.content)).toEqual(["m2", "m3", "m4", "m5", "m6"]);
    expect(data.messages.sentTruncated).toBe(true);
    expect(data.notifications.map((row) => row.body)).toEqual(["n4", "n5", "n6"]);
    expect(data.notificationsTruncated).toBe(true);
    expect(data.limits).toEqual({ notifications: 3, sentMessages: 5 });
  });
});
