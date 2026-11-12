// @vitest-environment happy-dom
//
// ViewBeacon reports one view of a profile or event page, once it is on
// screen, to POST /api/views (which decides whether it counts). A remount
// or a return to the page in the same load does not ask again, and a failed
// request never surfaces.

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ViewBeacon from "./ViewBeacon";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(answer: () => Promise<Response>) {
  const fetchMock = vi.fn(answer);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ViewBeacon", () => {
  it("sends the target and the server's source once, same-origin, and renders nothing", async () => {
    const fetchMock = stubFetch(async () => new Response(null, { status: 204 }));
    const { container, unmount } = render(<ViewBeacon kind="profile" id="user-1" source="search" />);
    expect(container.innerHTML).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/views");
    expect(init).toMatchObject({ credentials: "same-origin", keepalive: true, method: "POST" });
    expect(JSON.parse(init.body as string)).toEqual({ id: "user-1", kind: "profile", source: "search" });

    // Back to the same page in this load: not asked again.
    unmount();
    render(<ViewBeacon kind="profile" id="user-1" source="direct" />);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Another page is.
    render(<ViewBeacon kind="event" id="user-1" source="event" />);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("swallows a failed request: a lost view is not the reader's problem", async () => {
    const fetchMock = stubFetch(async () => {
      throw new TypeError("offline");
    });
    render(<ViewBeacon kind="event" id="event-9" source="direct" />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(fetchMock.mock.results[0]?.value).rejects.toThrow("offline");
  });
});
