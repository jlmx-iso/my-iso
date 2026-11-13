import { NextRequest } from "next/server";
import type { Session } from "next-auth";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type * as EnvModule from "~/env";
import type { ExtendedPrismaClient } from "~/server/_db/softDelete";
import type * as PosthogModule from "~/server/_lib/posthog";
import { captureServerException } from "~/server/_lib/posthog";
import { MAX_TRPC_BATCH_SIZE } from "~/server/api/requestGuards";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

const state = vi.hoisted(() => ({
  db: undefined as ExtendedPrismaClient | undefined,
  /** Every query of the app's database fails, as when D1 is unreachable. */
  dbDown: false,
  /** Reading the session fails, so no context can be built. */
  authFails: false,
  nodeEnv: "test",
  session: null as Session | null,
}));

vi.mock("~/server/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return undefined;
        if (!state.db) throw new Error("test database not ready");
        if (state.dbDown) {
          return new Proxy({}, { get: () => () => Promise.reject(new Error("D1 unavailable: internal detail")) });
        }
        return Reflect.get(state.db, prop) as unknown;
      },
    },
  ),
}));
vi.mock("~/auth", () => ({
  auth: vi.fn(async () => {
    if (state.authFails) throw new Error("session store unavailable");
    return state.session;
  }),
}));
vi.mock("~/_lib", () => ({ cloudinaryClient: null }));
vi.mock("~/server/_lib/posthog", async (importOriginal) => ({
  ...(await importOriginal<typeof PosthogModule>()),
  captureServerException: vi.fn(),
}));
vi.mock("~/env", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return {
    env: new Proxy(actual.env, {
      get: (target, prop) => (prop === "NODE_ENV" ? state.nodeEnv : (Reflect.get(target, prop) as unknown)),
    }),
  };
});

import { GET, POST } from "./route";

const BASE = "http://localhost:3000/api/trpc";

let testDb: TestDb;
let member: { email: string; id: string };

beforeAll(async () => {
  testDb = await createTestDb();
  state.db = testDb.db;
  const user = await createTestUser(testDb.db, { firstName: "Route", isDiscoverable: true });
  member = { email: user.email, id: user.id };
});

afterAll(async () => {
  await testDb.close();
});

beforeEach(() => {
  state.dbDown = false;
  state.authFails = false;
  state.nodeEnv = "test";
  state.session = null;
  vi.mocked(captureServerException).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

function signIn() {
  state.session = {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: { email: member.email, firstName: "Route", id: member.id, lastName: "", name: "Route" },
  };
}

async function errorCode(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { error?: { json?: { data?: { code?: string } } } };
  return body.error?.json?.data?.code;
}

describe("/api/trpc", () => {
  it("answers a query for a signed-in member", async () => {
    signIn();

    const response = await GET(new NextRequest(`${BASE}/discover.getPreferences`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result: { data: { json: { isDiscoverable: true, seekingTypes: [] } } },
    });
  });

  it("refuses an anonymous caller without reporting it as a fault", async () => {
    const response = await GET(new NextRequest(`${BASE}/discover.getPreferences`));

    expect(response.status).toBe(401);
    await expect(errorCode(response)).resolves.toBe("UNAUTHORIZED");
    expect(captureServerException).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    // Not even a warning outside development.
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("logs a caller's mistake as a warning while developing", async () => {
    state.nodeEnv = "development";

    const response = await GET(new NextRequest(`${BASE}/discover.getPreferences`));

    expect(response.status).toBe(401);
    expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).toContain("tRPC rejected a request");
    expect(captureServerException).not.toHaveBeenCalled();
  });

  it("reports a server fault with the procedure and user id, never the input", async () => {
    signIn();
    state.dbDown = true;

    const response = await POST(
      new NextRequest(`${BASE}/discover.updatePreferences`, {
        body: JSON.stringify({ json: { seekingTypes: ["private-wedding-detail"] } }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(500);
    await expect(errorCode(response)).resolves.toBe("INTERNAL_SERVER_ERROR");
    expect(captureServerException).toHaveBeenCalledTimes(1);
    const [error, context] = vi.mocked(captureServerException).mock.calls[0] ?? [];
    expect(error).toEqual(new Error("D1 unavailable: internal detail"));
    expect(context).toEqual({
      distinctId: member.id,
      extra: { code: "INTERNAL_SERVER_ERROR", procedure: "discover.updatePreferences" },
      path: "/api/trpc/discover.updatePreferences",
      source: "trpc",
    });
    expect(JSON.stringify(context)).not.toContain("private-wedding-detail");
  });

  it("reports an anonymous caller's server fault without a user id", async () => {
    state.dbDown = true;
    const input = encodeURIComponent(JSON.stringify({ json: { photographerId: "ph-1" } }));

    const response = await GET(new NextRequest(`${BASE}/photographer.getPortfolioImages?input=${input}`));

    expect(response.status).toBe(500);
    expect(vi.mocked(captureServerException).mock.calls[0]?.[1]).toMatchObject({
      distinctId: undefined,
      path: "/api/trpc/photographer.getPortfolioImages",
    });
  });

  it("reports a failure to build the request context", async () => {
    state.authFails = true;

    const response = await GET(new NextRequest(`${BASE}/discover.getPreferences`));

    expect(response.status).toBe(500);
    const [error, context] = vi.mocked(captureServerException).mock.calls[0] ?? [];
    expect(error).toEqual(new Error("session store unavailable"));
    expect(context).toMatchObject({ distinctId: undefined, source: "trpc" });
  });

  it("refuses an oversized body and an oversized or mutating batch before any procedure runs", async () => {
    const tooLarge = await POST(
      new NextRequest(`${BASE}/discover.updatePreferences`, {
        body: "{}",
        headers: { "content-length": String(10 * 1024 * 1024) },
        method: "POST",
      }),
    );
    expect(tooLarge.status).toBe(413);

    const paths = Array.from({ length: MAX_TRPC_BATCH_SIZE + 1 }, () => "discover.getPreferences").join(",");
    const bigBatch = await GET(new NextRequest(`${BASE}/${paths}?batch=1`));
    expect(bigBatch.status).toBe(400);

    const mutationBatch = await POST(
      new NextRequest(`${BASE}/discover.updatePreferences,discover.updatePreferences?batch=1`, {
        body: "{}",
        method: "POST",
      }),
    );
    expect(mutationBatch.status).toBe(400);
    expect(captureServerException).not.toHaveBeenCalled();
  });
});
