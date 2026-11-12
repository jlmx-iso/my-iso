// Feature flag evaluation against the real posthog-node SDK. Only the HTTP
// layer is replaced, so this pins what the SDK actually returns for each
// answer PostHog can give, and with it the invite-only rule in ~/auth:
// sign-up is invite-only unless the flag is explicitly `false`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const env: Record<string, string | undefined> = {};
  return { env };
});

vi.mock("~/env", () => ({ env: mocks.env }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("not on Cloudflare");
  },
}));
vi.mock("~/_utils", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { FeatureFlags, getFeatureFlagVariant } from "~/app/_lib/posthog";

/** The rule `isInviteOnly` in src/auth.ts applies to the flag's value. */
const inviteOnly = async () =>
  (await getFeatureFlagVariant("hashed-email", FeatureFlags.INVITE_ONLY)) !== false;

type FlagsRequest = { body: Record<string, unknown>; url: string };
let requests: FlagsRequest[];

/** Makes PostHog's `/flags` endpoint answer with `respond`. */
function posthogAnswers(respond: () => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes("/flags")) return Response.json({ status: 1 });
      requests.push({
        body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>,
        url,
      });
      return respond();
    }),
  );
}

function flag(enabled: boolean, variant?: string) {
  return {
    enabled,
    key: "invite-only",
    metadata: { id: 1, payload: '{"secret":"payload"}', version: 3 },
    reason: { code: "condition_match", condition_index: 0, description: "Matched condition set 1" },
    variant: variant ?? null,
  };
}

const flagsResponse = (flags: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  Response.json({ errorsWhileComputingFlags: false, flags, requestId: "r1", ...extra });

beforeEach(() => {
  requests = [];
  for (const key of Object.keys(mocks.env)) delete mocks.env[key];
  Object.assign(mocks.env, {
    APP_ENV: "staging",
    NEXT_PUBLIC_POSTHOG_PUBLIC_KEY: "phc_test",
    NODE_ENV: "production",
    POSTHOG_HOST: "https://posthog.test",
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getFeatureFlagVariant with the real SDK", () => {
  it("asks the supported /flags API for exactly this flag, with the project token", async () => {
    posthogAnswers(() => flagsResponse({ "invite-only": flag(true) }));
    await getFeatureFlagVariant("hashed-email", FeatureFlags.INVITE_ONLY);

    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]?.url ?? "").origin).toBe("https://posthog.test");
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/flags/");
    expect(requests[0]?.body).toMatchObject({
      distinct_id: "hashed-email",
      flag_keys_to_evaluate: ["invite-only"],
      token: "phc_test",
    });
    expect(requests[0]?.url).not.toContain("decide");
  });

  it("flag on: true, so sign-up is invite-only", async () => {
    posthogAnswers(() => flagsResponse({ "invite-only": flag(true) }));
    await expect(getFeatureFlagVariant("hashed-email", FeatureFlags.INVITE_ONLY)).resolves.toBe(true);
    await expect(inviteOnly()).resolves.toBe(true);
  });

  it("flag on with a variant: the variant name, still invite-only", async () => {
    posthogAnswers(() => flagsResponse({ "invite-only": flag(true, "strict") }));
    await expect(getFeatureFlagVariant("hashed-email", FeatureFlags.INVITE_ONLY)).resolves.toBe("strict");
    await expect(inviteOnly()).resolves.toBe(true);
  });

  it("flag active but off for this id: false, the only answer that opens sign-up", async () => {
    posthogAnswers(() => flagsResponse({ "invite-only": flag(false) }));
    await expect(getFeatureFlagVariant("hashed-email", FeatureFlags.INVITE_ONLY)).resolves.toBe(false);
    await expect(inviteOnly()).resolves.toBe(false);
  });

  it("flag missing or disabled in PostHog: undefined, invite-only", async () => {
    posthogAnswers(() => flagsResponse({}));
    await expect(getFeatureFlagVariant("hashed-email", FeatureFlags.INVITE_ONLY)).resolves.toBeUndefined();
    await expect(inviteOnly()).resolves.toBe(true);
  });

  it.each([
    ["PostHog answers 500", () => new Response("oops", { status: 500 })],
    ["PostHog answers 401", () => new Response("bad token", { status: 401 })],
    ["the response is not JSON", () => new Response("<html>", { status: 200 })],
    [
      "the network fails",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
    [
      "the flags quota is exhausted",
      () => flagsResponse({ "invite-only": flag(false) }, { quotaLimited: ["feature_flags"] }),
    ],
  ])("fails closed when %s", async (_name, respond) => {
    posthogAnswers(respond);
    await expect(getFeatureFlagVariant("hashed-email", FeatureFlags.INVITE_ONLY)).resolves.toBeUndefined();
    await expect(inviteOnly()).resolves.toBe(true);
  });

  it("throws when PostHog is not configured, which the caller also treats as invite-only", async () => {
    delete mocks.env.NEXT_PUBLIC_POSTHOG_PUBLIC_KEY;
    posthogAnswers(() => flagsResponse({ "invite-only": flag(false) }));
    await expect(getFeatureFlagVariant("hashed-email", FeatureFlags.INVITE_ONLY)).rejects.toThrow(
      /not configured/,
    );
    expect(requests).toHaveLength(0);
  });

  it("sends no exposure event and never logs the payload", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(new URL(input instanceof Request ? input.url : String(input)).pathname);
        return flagsResponse({ "invite-only": flag(true) });
      }),
    );
    await getFeatureFlagVariant("hashed-email", FeatureFlags.INVITE_ONLY);

    expect(calls).toEqual(["/flags/"]);
    const logged = JSON.stringify([
      vi.mocked(console.error).mock.calls,
      vi.mocked(console.warn).mock.calls,
    ]);
    expect(logged).not.toContain("secret");
  });
});
