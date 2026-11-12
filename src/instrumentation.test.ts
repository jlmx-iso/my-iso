import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ captureServerException: vi.fn() }));
vi.mock("~/server/_lib/posthog", () => ({ captureServerException: mocks.captureServerException }));

import { distinctIdFromCookie, onRequestError } from "./instrumentation";

const TOKEN = "phc_test";
const routeContext = {
  renderSource: undefined,
  revalidateReason: undefined,
  routePath: "/app/messages/[id]",
  routeType: "render",
  routerKind: "App Router",
} as const;

/** The cookie posthog-js writes for a visitor in the given state. */
function posthogCookie(state: Record<string, unknown>): string {
  return `ph_${TOKEN}_posthog=${encodeURIComponent(JSON.stringify(state))}`;
}
const IDENTIFIED = posthogCookie({ $user_state: "identified", distinct_id: "user_1" });

async function report(headers: Record<string, string | string[]>) {
  const error = new Error("render failed");
  await onRequestError(
    error,
    { headers, method: "GET", path: "/app/messages/t1?email=a@b.co" },
    routeContext,
  );
  expect(mocks.captureServerException).toHaveBeenCalledOnce();
  const [reported, context, options] = mocks.captureServerException.mock.calls[0] as [
    unknown,
    { distinctId?: string; extra: Record<string, unknown>; path: string; source: string },
    { consent: string },
  ];
  expect(reported).toBe(error);
  return { context, options };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PUBLIC_KEY", TOKEN);
});

describe("onRequestError", () => {
  it("attaches the signed-in visitor's id and the route", async () => {
    const { context, options } = await report({ cookie: `a=1; ${IDENTIFIED}` });
    expect(context).toEqual({
      distinctId: "user_1",
      extra: { method: "GET", routePath: "/app/messages/[id]", routeType: "render" },
      path: "/app/messages/t1?email=a@b.co",
      source: "next",
    });
    expect(options).toEqual({ consent: "unknown" });
  });

  it("never attaches a Global Privacy Control visitor, even with an old identified cookie", async () => {
    const { context, options } = await report({ cookie: IDENTIFIED, "sec-gpc": "1" });
    expect(context.distinctId).toBeUndefined();
    expect(options).toEqual({ consent: "denied" });
  });

  it("never attaches a visitor whose consent cookie says denied", async () => {
    const { context, options } = await report({ cookie: `${IDENTIFIED}; iso_consent=denied` });
    expect(context.distinctId).toBeUndefined();
    expect(options).toEqual({ consent: "denied" });
  });

  it("resolves consent from the headers it is given, in whatever shape", async () => {
    const granted = await report({ cookie: ["iso_consent=granted", IDENTIFIED] });
    expect(granted.options).toEqual({ consent: "granted" });
    expect(granted.context.distinctId).toBe("user_1");

    vi.clearAllMocks();
    const gpc = await report({ cookie: IDENTIFIED, "sec-gpc": ["1"] });
    expect(gpc.options).toEqual({ consent: "denied" });
  });

  it("reports anonymously when there is no PostHog cookie", async () => {
    const { context } = await report({});
    expect(context.distinctId).toBeUndefined();
  });
});

describe("distinctIdFromCookie", () => {
  it("returns the id of an identified visitor only", () => {
    expect(distinctIdFromCookie(IDENTIFIED)).toBe("user_1");
    expect(
      distinctIdFromCookie(posthogCookie({ $user_state: "anonymous", distinct_id: "anon-uuid" })),
    ).toBeUndefined();
    expect(distinctIdFromCookie(posthogCookie({ distinct_id: "anon-uuid" }))).toBeUndefined();
  });

  it("ignores other projects' cookies and malformed values", () => {
    expect(distinctIdFromCookie(IDENTIFIED.replace(TOKEN, "phc_other"))).toBeUndefined();
    expect(distinctIdFromCookie(`ph_${TOKEN}_posthog=%7Bnot-json`)).toBeUndefined();
    expect(distinctIdFromCookie(`ph_${TOKEN}_posthog=%E0%A4%A`)).toBeUndefined();
    expect(distinctIdFromCookie(`ph_${TOKEN}_posthog=null`)).toBeUndefined();
    expect(distinctIdFromCookie(undefined)).toBeUndefined();
  });

  it("returns nothing when PostHog is not configured", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PUBLIC_KEY", "");
    expect(distinctIdFromCookie(IDENTIFIED)).toBeUndefined();
  });
});
