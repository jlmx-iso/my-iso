import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_POSTHOG_ASSETS_HOST, DEFAULT_POSTHOG_HOST } from "~/telemetryConfig";

import { GET, HEAD, POST } from "./route";

// PostHog is never called: `fetch` is replaced at the boundary.
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("ok", { headers: { "set-cookie": "ph=1" }, status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function upstreamUrl(): string {
  const input = fetchMock.mock.calls[0]?.[0];
  if (typeof input !== "string") throw new Error("fetch was not called with a URL string");
  return input;
}

describe("the telemetry proxy route (no Worker in front)", () => {
  it("serves the SDK from PostHog's assets host, by the public path or the route's own", async () => {
    for (const path of ["/lens/static/array.js", "/api/lens/static/array.js"]) {
      fetchMock.mockClear();
      const response = await GET(new Request(`http://localhost:3000${path}?v=1.2`));

      expect(response.status).toBe(200);
      expect(upstreamUrl()).toBe(`${DEFAULT_POSTHOG_ASSETS_HOST}/static/array.js?v=1.2`);
      // PostHog's cookies never reach the browser.
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("forwards events to the API host without the visitor's cookies", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/lens/e/", {
        body: JSON.stringify({ event: "$pageview" }),
        headers: { cookie: "authjs.session-token=secret", "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(upstreamUrl()).toBe(`${DEFAULT_POSTHOG_HOST}/e/`);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("cookie")).toBeNull();
  });

  it("forwards nothing when analytics are refused", async () => {
    const response = await POST(
      new Request("http://localhost:3000/lens/e/", {
        body: "{}",
        headers: { "sec-gpc": "1" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses paths and methods outside the proxy's list", async () => {
    await expect(GET(new Request("http://localhost:3000/api/lens/api/projects"))).resolves.toHaveProperty("status", 404);
    await expect(HEAD(new Request("http://localhost:3000/api/lens/e/", { method: "HEAD" }))).resolves.toHaveProperty(
      "status",
      405,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
