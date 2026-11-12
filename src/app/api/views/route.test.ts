import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

const holder = vi.hoisted((): { db: unknown; session: { user: { id: string } } | null } => ({ db: null, session: null }));

vi.mock("~/server/db", () => ({
  get db() {
    return holder.db;
  },
}));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => holder.session) }));
vi.mock("~/_lib/site", () => ({ SITE_URL: "https://myiso.app" }));

import { POST } from "./route";

const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

describe("POST /api/views", () => {
  let testDb: TestDb;
  let owner: { id: string };

  function view(body: unknown, headers: Record<string, string> = {}): Request {
    return new Request("https://myiso.app/api/views", {
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", "origin": "https://myiso.app", "user-agent": BROWSER, ...headers },
      method: "POST",
    });
  }
  const profile = () => ({ id: owner.id, kind: "profile", source: "search" });
  const count = async () => (await testDb.db.profileView.aggregate({ _sum: { count: true } }))._sum.count ?? 0;

  beforeEach(async () => {
    testDb = await createTestDb();
    holder.db = testDb.db;
    holder.session = null;
    owner = await createTestUser(testDb.db);
    await testDb.db.photographer.create({ data: { companyName: "S", location: "Austin", name: "Owner", userId: owner.id } });
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("counts once per browser: the second request with the cookie it got is not counted", async () => {
    const first = await POST(view(profile()));
    expect(first.status).toBe(204);
    const setCookie = first.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^iso_views=[^;]+; Path=\/api\/views; Max-Age=\d+; HttpOnly; SameSite=Lax; Secure$/);

    const cookie = setCookie.split(";")[0] ?? "";
    const second = await POST(view(profile(), { cookie }));
    expect(second.status).toBe(204);
    expect(second.headers.get("set-cookie")).toBeNull();
    expect(await count()).toBe(1);
  });

  it("refuses another origin, a bad body and an oversized one, writing nothing", async () => {
    expect((await POST(view(profile(), { origin: "https://evil.example" }))).status).toBe(403);
    const noOrigin = new Request("https://myiso.app/api/views", { body: JSON.stringify(profile()), method: "POST" });
    expect((await POST(noOrigin)).status).toBe(403);
    expect((await POST(view("{not json"))).status).toBe(400);
    expect((await POST(view({ ...profile(), source: "https://somewhere" }))).status).toBe(400);
    expect((await POST(view({ ...profile(), id: "x".repeat(600) }))).status).toBe(413);
    expect(await count()).toBe(0);
  });

  it("answers the same whatever happened, and never fails the page", async () => {
    holder.session = { user: { id: owner.id } };
    expect((await POST(view(profile()))).status).toBe(204);
    holder.db = {};
    expect((await POST(view(profile()))).status).toBe(204);
    holder.db = testDb.db;
    expect(await count()).toBe(0);
  });
});
