import { beforeEach, describe, expect, it, vi } from "vitest";

const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders.current }));

import { requestRequiresOptIn } from "./consentRegion";

describe("requestRequiresOptIn", () => {
  beforeEach(() => {
    requestHeaders.current = new Headers();
  });

  it("is true for a request the Worker placed in an opt-in region", async () => {
    requestHeaders.current = new Headers({ "x-iso-country": "IE" });
    expect(await requestRequiresOptIn()).toBe(true);
  });

  it("is false elsewhere and without a country", async () => {
    requestHeaders.current = new Headers({ "x-iso-country": "US" });
    expect(await requestRequiresOptIn()).toBe(false);
    requestHeaders.current = new Headers();
    expect(await requestRequiresOptIn()).toBe(false);
  });
});
