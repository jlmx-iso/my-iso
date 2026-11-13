import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtendedPrismaClient } from "~/server/_db/softDelete";
import { createTestDb, type TestDb } from "~/test/helpers/sqlite";

const state = vi.hoisted(() => ({ db: undefined as Pick<ExtendedPrismaClient, "$queryRaw"> | undefined }));

vi.mock("~/server/db", () => ({
  db: {
    $queryRaw: (...args: unknown[]) => {
      if (!state.db) throw new Error("no database");
      return (state.db.$queryRaw as (...a: unknown[]) => Promise<unknown>)(...args);
    },
  },
}));

import { GET } from "./route";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.close();
});

beforeEach(() => {
  state.db = testDb.db;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /api/health", () => {
  it("is ok, uncached, when the database answers", async () => {
    vi.stubEnv("APP_VERSION", "1.2.3");
    vi.stubEnv("APP_COMMIT", "abc1234");
    const response = await GET();
    vi.unstubAllEnvs();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      build: { environment: "development" },
      checks: { database: "ok" },
      commit: "abc1234",
      environment: "development",
      status: "ok",
      version: "1.2.3",
    });
  });

  it("is degraded with 503 when the database does not answer, and says nothing more", async () => {
    state.db = { $queryRaw: (() => Promise.reject(new Error("D1_ERROR: secret detail"))) as never };

    const response = await GET();

    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ checks: { database: "error" }, commit: "unknown", status: "degraded", version: "unknown" });
    expect(JSON.stringify(body)).not.toContain("secret detail");
    expect(console.error).toHaveBeenCalled();
  });
});
