import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ExtendedPrismaClient } from "~/server/_db/softDelete";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

const state = vi.hoisted(() => ({
  calls: [] as { element: unknown }[],
  db: undefined as ExtendedPrismaClient | undefined,
}));

// The image renderer (Satori and resvg, WebAssembly) is replaced at the
// boundary: what is under test is what the route asks it to draw.
vi.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor(element: unknown, options: { headers?: Record<string, string> }) {
      super("png", { headers: { "content-type": "image/png", ...options.headers } });
      state.calls.push({ element });
    }
  },
}));
vi.mock("~/server/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return undefined;
        if (!state.db) throw new Error("test database not ready");
        return Reflect.get(state.db, prop) as unknown;
      },
    },
  ),
}));

import { GET } from "./route";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  state.db = testDb.db;
});

afterAll(async () => {
  await testDb.close();
});

async function photographer(handle: string, data: { avatar?: string; companyName?: string; location?: string; name: string }) {
  const user = await createTestUser(testDb.db);
  await testDb.db.user.update({ data: { handle }, where: { id: user.id } });
  await testDb.db.photographer.create({ data: { companyName: "", location: "", ...data, userId: user.id } });
}

const card = (handle: string) => GET(new Request(`http://localhost:3000/api/og/photographer?handle=${handle}`));
const lastMarkup = () => renderToStaticMarkup(state.calls.at(-1)?.element as ReactElement);

describe("GET /api/og/photographer", () => {
  it("needs a handle of a sensible length", async () => {
    await expect(GET(new Request("http://localhost:3000/api/og/photographer"))).resolves.toHaveProperty("status", 400);
    await expect(card("h".repeat(65))).resolves.toHaveProperty("status", 400);
  });

  it("answers 404 for a handle nobody has", async () => {
    await expect(card("nobody")).resolves.toHaveProperty("status", 404);
  });

  it("draws the name, company, location and an avatar from the app's own cloud", async () => {
    const avatar = "https://res.cloudinary.com/test-cloud/image/upload/v1/u/avatar.jpg";
    await photographer("sarah", { avatar, companyName: "Chen Studio", location: "Austin, TX", name: "Sarah Chen" });

    const response = await card("sarah");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=604800");
    const markup = lastMarkup();
    for (const text of ["Sarah Chen", "Chen Studio", "Austin, TX"]) expect(markup).toContain(text);
    expect(markup).toContain(`src="${avatar}"`);
  });

  it("never asks the renderer to fetch an avatar from another host", async () => {
    await photographer("ssrf", { avatar: "http://169.254.169.254/latest/meta-data", name: "" });

    await card("ssrf");

    const markup = lastMarkup();
    expect(markup).not.toContain("169.254.169.254");
    // No name, company or location: the placeholder name, nothing else.
    expect(markup).toContain("Photographer");
  });
});
