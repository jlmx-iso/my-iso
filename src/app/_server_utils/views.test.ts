import { describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ headers: new Headers() }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("~/_lib/site", () => ({ SITE_URL: "https://myiso.app" }));

import { verifiedViewSource } from "~/server/_lib/viewCounter";

import { viewBeaconProps, viewSource } from "./views";

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

  it("gives the beacon the source with a token the counter accepts, for this target only", async () => {
    request.headers = new Headers({ referer: "https://myiso.app/app/events/e1" });
    const now = new Date("2030-06-15T12:00:00Z");
    const props = await viewBeaconProps({ id: "u1", kind: "profile" }, now);
    expect(props).toMatchObject({ id: "u1", kind: "profile", source: "event" });
    expect(await verifiedViewSource({ id: "u1", kind: "profile" }, "event", props.token, now)).toBe("event");
    expect(await verifiedViewSource({ id: "u2", kind: "profile" }, "event", props.token, now)).toBe("other");
  });
});
