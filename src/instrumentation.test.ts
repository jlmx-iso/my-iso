import { encode } from "next-auth/jwt";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ captureServerException: vi.fn() }));
vi.mock("~/server/_lib/posthog", () => ({ captureServerException: mocks.captureServerException }));

import { onRequestError, sessionUserIdFromCookie } from "./instrumentation";

const TOKEN = "phc_test";
const SECRET = "test-secret-at-least-thirty-two-characters-long";
const SECURE_NAME = "__Secure-authjs.session-token";
const PLAIN_NAME = "authjs.session-token";
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
/** A PostHog cookie claiming to be someone: client-controlled, never trusted. */
const FORGED_POSTHOG = posthogCookie({ $user_state: "identified", distinct_id: "user_victim" });

/** A session cookie as Auth.js issues it (encrypted JWT, salted with its name). */
async function sessionCookie(
  claims: Record<string, unknown>,
  options: { name?: string; secret?: string; maxAge?: number } = {},
): Promise<string> {
  const name = options.name ?? SECURE_NAME;
  const value = await encode({
    maxAge: options.maxAge ?? 60 * 60,
    salt: name,
    secret: options.secret ?? SECRET,
    token: claims,
  });
  return `${name}=${value}`;
}

let IDENTIFIED: string;

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

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PUBLIC_KEY", TOKEN);
  vi.stubEnv("AUTH_SECRET", SECRET);
  IDENTIFIED = await sessionCookie({ id: "user_1", sub: "user_1" });
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

  it("never attributes an error from a client-controlled PostHog cookie", async () => {
    const { context } = await report({ cookie: FORGED_POSTHOG });
    expect(context.distinctId).toBeUndefined();
  });

  it("never attaches a Global Privacy Control visitor, even with a valid session", async () => {
    const { context, options } = await report({ cookie: IDENTIFIED, "sec-gpc": "1" });
    expect(context.distinctId).toBeUndefined();
    expect(options).toEqual({ consent: "denied" });
  });

  it("never attaches a visitor whose consent cookie says denied", async () => {
    const { context, options } = await report({ cookie: `${IDENTIFIED}; iso_consent=denied` });
    expect(context.distinctId).toBeUndefined();
    expect(options).toEqual({ consent: "denied" });
  });

  it("sends only the route pattern for a visitor who refused, not their path", async () => {
    const { context } = await report({ cookie: "iso_consent=denied" });
    expect(context.path).toBe("/app/messages/[id]");
    const gpc = (vi.clearAllMocks(), await report({ "sec-gpc": "1" }));
    expect(gpc.context.path).toBe("/app/messages/[id]");
  });

  it("resolves consent from the headers it is given, in whatever shape", async () => {
    const granted = await report({ cookie: ["iso_consent=granted", IDENTIFIED] });
    expect(granted.options).toEqual({ consent: "granted" });
    expect(granted.context.distinctId).toBe("user_1");

    vi.clearAllMocks();
    const gpc = await report({ cookie: IDENTIFIED, "sec-gpc": ["1"] });
    expect(gpc.options).toEqual({ consent: "denied" });
  });

  it("reports anonymously when there is no session", async () => {
    const { context } = await report({});
    expect(context.distinctId).toBeUndefined();
  });
});

describe("sessionUserIdFromCookie", () => {
  it("reads the user id from a valid session, under either cookie name", async () => {
    expect(await sessionUserIdFromCookie(`a=1; ${IDENTIFIED}`)).toBe("user_1");
    const plain = await sessionCookie({ id: "user_2" }, { name: PLAIN_NAME });
    expect(await sessionUserIdFromCookie(plain)).toBe("user_2");
  });

  it("is anonymous for anything that is not a session this deployment issued", async () => {
    // Signed with another secret.
    expect(await sessionUserIdFromCookie(await sessionCookie({ id: "user_1" }, { secret: `${SECRET}-other` }))).toBeUndefined();
    // Expired.
    expect(await sessionUserIdFromCookie(await sessionCookie({ id: "user_1" }, { maxAge: -60 }))).toBeUndefined();
    // Encrypted for one cookie name, presented under the other.
    const moved = (await sessionCookie({ id: "user_1" }, { name: PLAIN_NAME })).replace(PLAIN_NAME, SECURE_NAME);
    expect(await sessionUserIdFromCookie(moved)).toBeUndefined();
    // No id claim, garbage, nothing.
    expect(await sessionUserIdFromCookie(await sessionCookie({ sub: "x" }))).toBeUndefined();
    expect(await sessionUserIdFromCookie(`${SECURE_NAME}=not-a-jwt`)).toBeUndefined();
    expect(await sessionUserIdFromCookie(FORGED_POSTHOG)).toBeUndefined();
    expect(await sessionUserIdFromCookie(undefined)).toBeUndefined();
  });

  it("is anonymous without AUTH_SECRET", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    expect(await sessionUserIdFromCookie(IDENTIFIED)).toBeUndefined();
  });
});
