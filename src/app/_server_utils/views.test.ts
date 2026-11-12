import { describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ headers: new Headers() }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("~/_lib/site", () => ({ SITE_URL: "https://myiso.app" }));

import { viewSource } from "./views";

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
