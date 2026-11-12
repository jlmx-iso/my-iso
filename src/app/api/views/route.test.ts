import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "~/_utils";
import { utcDay, VIEW_ANON_LIMIT, VIEW_RATE_LIMIT, viewSourceToken } from "~/server/_lib/viewCounter";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

const holder = vi.hoisted(
  (): { db: unknown; env: Record<string, unknown> | null; session: { user: { id: string } } | null } => ({
    db: null,
    env: null,
    session: null,
  }),
);

vi.mock("~/server/db", () => ({
  get db() {
    return holder.db;
  },
}));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => holder.session) }));
vi.mock("~/_lib/site", () => ({ SITE_URL: "https://myiso.app" }));
// On Cloudflare the bindings are in the context; off it, getCloudflareContext throws.
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (!holder.env) throw new Error("not on Cloudflare");
    return { env: holder.env };
  },
}));

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
    holder.env = null;
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

  it("two identical requests from a signed-in member count once, even without the cookie (another device)", async () => {
    const member = await createTestUser(testDb.db);
    holder.session = { user: { id: member.id } };
    expect((await POST(view(profile()))).status).toBe(204);
    expect((await POST(view(profile()))).status).toBe(204);
    expect(await count()).toBe(1);
  });

  it("a cookie-less loop from one address counts once, and writes at most the per-address limit", async () => {
    const execute = vi.spyOn(testDb.db, "$executeRaw");
    const headers = { "cf-connecting-ip": "192.0.2.44" };
    for (let index = 0; index < 60; index += 1) {
      expect((await POST(view(profile(), headers))).status).toBe(204);
    }
    expect(await count()).toBe(1);
    // A "seen" insert per admitted request, and the one count.
    expect(execute.mock.calls.length).toBeLessThanOrEqual(VIEW_RATE_LIMIT.limit + 1);
    expect(VIEW_RATE_LIMIT.limit).toBeLessThan(VIEW_ANON_LIMIT.limit);
  });

  it("on Cloudflare without a binding, counts nothing (no per-isolate fallback) and logs it once", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const admit = { limit: async () => ({ success: true }) };
    for (const env of [{ VIEW_COUNT_LIMIT: admit }, { VIEW_ANON_LIMIT: admit }, {}]) {
      holder.env = env;
      expect((await POST(view(profile(), { "cf-connecting-ip": "192.0.2.46" }))).status).toBe(204);
    }
    expect(await count()).toBe(0);
    expect(error.mock.calls.filter(([message]) => String(message).includes("binding is missing"))).toHaveLength(1);
    // With both, it counts.
    holder.env = { VIEW_ANON_LIMIT: admit, VIEW_COUNT_LIMIT: admit };
    expect((await POST(view(profile(), { "cf-connecting-ip": "192.0.2.46" }))).status).toBe(204);
    expect(await count()).toBe(1);
  });

  it("uses Cloudflare's Rate Limiting bindings when the Worker has them", async () => {
    const keys: Array<[string, string]> = [];
    const binding = (name: string, success: boolean) => ({
      limit: async ({ key }: { key: string }) => {
        keys.push([name, key]);
        return { success };
      },
    });
    holder.env = { VIEW_ANON_LIMIT: binding("anonymous", false), VIEW_COUNT_LIMIT: binding("perClient", true) };
    expect((await POST(view(profile(), { "cf-connecting-ip": "192.0.2.45" }))).status).toBe(204);
    // Admitted per address, refused by the shared anonymous cap: nothing written.
    expect(keys.map(([name]) => name)).toEqual(["perClient", "anonymous"]);
    expect(keys[0]?.[1]).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(keys[0]?.[1]).not.toContain("192.0.2.45");
    expect(await count()).toBe(0);
  });

  it("trusts the posted source only with the page's token: forged, wrong-target and stale-day tokens count as Other", async () => {
    const other = await createTestUser(testDb.db);
    const today = utcDay(new Date());
    const twoDaysAgo = utcDay(new Date(Date.now() - 2 * 86_400_000));
    const tokens = {
      forged: "f".repeat(32),
      none: undefined,
      stale: await viewSourceToken({ id: owner.id, kind: "profile" }, "search", twoDaysAgo),
      valid: await viewSourceToken({ id: owner.id, kind: "profile" }, "search", today),
      wrongTarget: await viewSourceToken({ id: other.id, kind: "profile" }, "search", today),
    };
    for (const [index, token] of Object.values(tokens).entries()) {
      // A different address each time, so each is a first view today.
      const response = await POST(view({ ...profile(), token }, { "cf-connecting-ip": `192.0.2.${100 + index}` }));
      expect(response.status).toBe(204);
    }
    const rows = await testDb.db.profileView.findMany({ orderBy: { source: "asc" } });
    expect(rows.map((row) => [row.source, row.count])).toEqual([["other", 4], ["search", 1]]);
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

  it("caps the body in bytes: by its declared length before reading, and while reading one without", async () => {
    // Declared too long: refused without reading a byte.
    const declared = view(profile(), { "content-length": "100000" });
    expect((await POST(declared)).status).toBe(413);
    expect(declared.bodyUsed).toBe(false);
    // 300 characters, 600 bytes.
    expect((await POST(view({ ...profile(), id: "é".repeat(300) }))).status).toBe(413);
    // A stream with no length that never ends is cut off at the cap.
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(256).fill(32));
      },
    });
    const streamed = new Request("https://myiso.app/api/views", {
      body: endless,
      duplex: "half",
      headers: { "origin": "https://myiso.app", "user-agent": BROWSER },
      method: "POST",
    } as RequestInit);
    expect((await POST(streamed)).status).toBe(413);
    expect(pulls).toBeLessThan(10);
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
