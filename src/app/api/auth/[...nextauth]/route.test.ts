import { describe, expect, it, vi } from "vitest";

// The handlers are Auth.js's; src/auth.signin.test.ts runs them with the
// app's configuration. This checks only that the route serves exactly them.
const handlers = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock("~/auth", () => ({ handlers }));

import * as route from "./route";

describe("/api/auth/[...nextauth]", () => {
  it("serves GET and POST with the Auth.js handlers, and nothing else", () => {
    expect(route.GET).toBe(handlers.GET);
    expect(route.POST).toBe(handlers.POST);
    expect(Object.keys(route).sort()).toEqual(["GET", "POST"]);
  });
});
