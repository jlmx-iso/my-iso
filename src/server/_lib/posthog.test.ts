import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = {
    captureExceptionImmediate: vi.fn(async () => undefined),
    captureImmediate: vi.fn(async () => undefined),
    evaluateFlags: vi.fn(),
    shutdown: vi.fn(async () => undefined),
  };
  const env: Record<string, string | undefined> = {};
  return {
    client,
    constructed: [] as Array<{ key: string; options: Record<string, unknown> }>,
    env,
    order: [] as string[],
    requestHeaders: null as Headers | null,
    waitUntil: vi.fn(),
  };
});

vi.mock("posthog-node", () => ({
  PostHog: class {
    captureExceptionImmediate = mocks.client.captureExceptionImmediate;
    captureImmediate = mocks.client.captureImmediate;
    evaluateFlags = mocks.client.evaluateFlags;
    shutdown = mocks.client.shutdown;
    constructor(key: string, options: Record<string, unknown>) {
      mocks.constructed.push({ key, options });
    }
  },
}));
vi.mock("~/env", () => ({ env: mocks.env }));
vi.mock("next/headers", () => ({
  headers: async () => {
    if (!mocks.requestHeaders) throw new Error("`headers` was called outside a request scope");
    return mocks.requestHeaders;
  },
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ ctx: { waitUntil: mocks.waitUntil } }),
}));
vi.mock("~/_utils", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { logger } from "~/_utils";

import { runAfterResponse } from "./background";
import {
  captureEvent,
  captureServerException,
  getFeatureFlag,
} from "./posthog";

/** Everything handed to waitUntil so far, settled. */
async function afterResponse(): Promise<void> {
  await Promise.all(mocks.waitUntil.mock.calls.map(([promise]) => promise as Promise<unknown>));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.constructed.length = 0;
  mocks.order.length = 0;
  mocks.requestHeaders = new Headers();
  for (const key of Object.keys(mocks.env)) delete mocks.env[key];
  Object.assign(mocks.env, {
    APP_ENV: "staging",
    NEXT_PUBLIC_POSTHOG_PUBLIC_KEY: "phc_test",
    NODE_ENV: "production",
  });
  mocks.client.captureImmediate.mockImplementation(async () => {
    mocks.order.push("capture");
  });
  mocks.client.shutdown.mockImplementation(async () => {
    mocks.order.push("shutdown");
  });
});

describe("captureEvent", () => {
  it("returns at once and sends under waitUntil, flushed before it settles", async () => {
    captureEvent("user-1", "message_sent", { platform: "web" });

    // Nothing was awaited by the caller; the work is the Worker's to keep alive.
    expect(mocks.waitUntil).toHaveBeenCalledOnce();
    await afterResponse();

    expect(mocks.client.captureImmediate).toHaveBeenCalledWith({
      distinctId: "user-1",
      event: "message_sent",
      properties: { environment: "staging", platform: "web" },
    });
    expect(mocks.order).toEqual(["capture", "shutdown"]);
  });

  it("uses a fresh, unbatched client per send, pointed at the configured host", async () => {
    mocks.env.POSTHOG_HOST = "https://eu.i.posthog.com";
    captureEvent("user-1", "a");
    captureEvent("user-1", "b");
    await afterResponse();

    expect(mocks.constructed).toHaveLength(2);
    expect(mocks.constructed[0]).toMatchObject({
      key: "phc_test",
      options: { flushAt: 1, flushInterval: 0, host: "https://eu.i.posthog.com" },
    });
    expect(mocks.client.shutdown).toHaveBeenCalledTimes(2);
  });

  it("defaults to PostHog US Cloud", async () => {
    captureEvent("user-1", "a");
    await afterResponse();
    expect(mocks.constructed[0]?.options.host).toBe("https://us.i.posthog.com");
  });

  it("sends nothing when the visitor refused analytics (cookie or Sec-GPC)", async () => {
    const refusals: Array<Record<string, string>> = [
      { cookie: "iso_consent=denied" },
      { "sec-gpc": "1" },
    ];
    for (const headers of refusals) {
      mocks.requestHeaders = new Headers(headers);
      captureEvent("user-1", "message_sent");
      await afterResponse();
    }
    expect(mocks.client.captureImmediate).not.toHaveBeenCalled();
  });

  it("still sends outside a request (jobs, webhooks)", async () => {
    mocks.requestHeaders = null;
    captureEvent("user-1", "subscription_started");
    await afterResponse();
    expect(mocks.client.captureImmediate).toHaveBeenCalledOnce();
  });

  it("is off without a project token and in the test environment", async () => {
    delete mocks.env.NEXT_PUBLIC_POSTHOG_PUBLIC_KEY;
    captureEvent("user-1", "a");
    mocks.env.NEXT_PUBLIC_POSTHOG_PUBLIC_KEY = "phc_test";
    mocks.env.NODE_ENV = "test";
    captureEvent("user-1", "a");
    await afterResponse();

    expect(mocks.waitUntil).not.toHaveBeenCalled();
    expect(mocks.constructed).toHaveLength(0);
  });

  it("a failed send is logged, not thrown, and the client is still shut down", async () => {
    mocks.client.captureImmediate.mockRejectedValueOnce(new Error("network down"));
    captureEvent("user-1", "a");
    await expect(afterResponse()).resolves.toBeUndefined();

    expect(mocks.client.shutdown).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      "Background task failed",
      expect.objectContaining({ task: "posthog:a" }),
    );
    // A failed report about telemetry is not itself reported.
    expect(mocks.client.captureExceptionImmediate).not.toHaveBeenCalled();
  });
});

describe("captureServerException", () => {
  it("sends the error with user id, path and source, and nothing else", async () => {
    const error = new Error("boom");
    captureServerException(error, {
      distinctId: "user-1",
      extra: { procedure: "event.create" },
      path: "/api/trpc/event.create?batch=1&input=%7B%22secret%22%7D",
      source: "trpc",
    });
    await afterResponse();

    expect(mocks.client.captureExceptionImmediate).toHaveBeenCalledWith(error, "user-1", {
      environment: "staging",
      path: "/api/trpc/event.create",
      procedure: "event.create",
      source: "trpc",
    });
    expect(mocks.client.shutdown).toHaveBeenCalledOnce();
  });

  it("scrubs what it sends: the client is built with a before_send that removes PII", async () => {
    captureServerException(new Error("boom"), { source: "trpc" });
    await afterResponse();

    const beforeSend = mocks.constructed[0]?.options.before_send as (event: {
      event: string;
      properties?: Record<string, unknown>;
    }) => { properties?: Record<string, unknown> } | null;
    const sent = beforeSend({
      event: "$exception",
      properties: {
        $exception_list: [{ value: "Code 123456 rejected for a@b.co at /join?code=ISO-TEST-ABCDEFGH" }],
        path: "/api/trpc/auth.verify",
      },
    });
    expect(sent?.properties).toEqual({
      $exception_list: [{ value: "Code [code] rejected for [email] at /join" }],
      path: "/api/trpc/auth.verify",
    });
  });

  it("uses the consent it is handed instead of looking for a request", async () => {
    // Where onRequestError runs there is no request scope to read.
    mocks.requestHeaders = null;
    const error = new Error("boom");

    captureServerException(error, { distinctId: "user-1", source: "next" }, { consent: "denied" });
    captureServerException(error, { distinctId: "user-1", source: "next" }, { consent: "unknown" });
    await afterResponse();

    expect(mocks.client.captureExceptionImmediate).toHaveBeenNthCalledWith(1, error, undefined, {
      environment: "staging",
      source: "next",
    });
    expect(mocks.client.captureExceptionImmediate).toHaveBeenNthCalledWith(2, error, "user-1", {
      environment: "staging",
      source: "next",
    });
  });

  it("for a visitor who refused analytics: still reported, with nothing of the visitor", async () => {
    mocks.requestHeaders = new Headers({ "sec-gpc": "1" });
    const error = new Error("boom");
    captureServerException(error, { distinctId: "user-1", source: "trpc" });
    await afterResponse();

    expect(mocks.client.captureExceptionImmediate).toHaveBeenCalledWith(error, undefined, {
      environment: "staging",
      source: "trpc",
    });
    // No id, no IP, no query string, no headers: only the error and where.
    const sent = JSON.stringify(mocks.client.captureExceptionImmediate.mock.calls[0]?.slice(1));
    expect(sent).not.toMatch(/user-1|\$ip|sec-gpc|cookie|\?/i);
  });
});

describe("runAfterResponse", () => {
  it("reports a failed task to error tracking inside the same kept-alive promise", async () => {
    const failure = new Error("email provider down");
    runAfterResponse("send-otp-email", async () => {
      throw failure;
    });
    await afterResponse();

    expect(mocks.waitUntil).toHaveBeenCalledOnce();
    expect(mocks.client.captureExceptionImmediate).toHaveBeenCalledWith(failure, undefined, {
      environment: "staging",
      source: "background",
      task: "send-otp-email",
    });
  });

  it("catches a task that throws before returning a promise", async () => {
    const task = (() => {
      throw new Error("sync");
    }) as unknown as () => Promise<unknown>;
    expect(() => runAfterResponse("sync-task", task)).not.toThrow();
    await afterResponse();
    expect(logger.error).toHaveBeenCalledWith(
      "Background task failed",
      expect.objectContaining({ task: "sync-task" }),
    );
  });
});

describe("feature flags", () => {
  const snapshot = (value: boolean | string | undefined) => ({ getFlag: vi.fn(() => value) });

  it("evaluates one flag through evaluateFlags, without exposure events", async () => {
    const flags = snapshot(false);
    mocks.client.evaluateFlags.mockResolvedValue(flags);

    await expect(getFeatureFlag("invite-only", "hash-1")).resolves.toBe(false);

    expect(mocks.client.evaluateFlags).toHaveBeenCalledWith("hash-1", { flagKeys: ["invite-only"] });
    expect(flags.getFlag).toHaveBeenCalledWith("invite-only", { sendFeatureFlagEvents: false });
    expect(mocks.client.shutdown).toHaveBeenCalledOnce();
  });

  it("answers undefined for a flag with no value, so callers fail closed", async () => {
    mocks.client.evaluateFlags.mockResolvedValue(snapshot(undefined));
    await expect(getFeatureFlag("invite-only", "hash-1")).resolves.toBeUndefined();
  });

  it("throws when PostHog is not configured or the id is empty", async () => {
    await expect(getFeatureFlag("invite-only", "")).rejects.toThrow(/distinct id/);
    delete mocks.env.NEXT_PUBLIC_POSTHOG_PUBLIC_KEY;
    await expect(getFeatureFlag("invite-only", "hash-1")).rejects.toThrow(/not configured/);
  });

  it("never logs flag values or payloads", async () => {
    mocks.client.evaluateFlags.mockResolvedValue(snapshot("variant-secret"));
    await getFeatureFlag("invite-only", "hash-1");
    const logged = JSON.stringify([
      vi.mocked(logger.info).mock.calls,
      vi.mocked(logger.debug).mock.calls,
      vi.mocked(logger.warn).mock.calls,
    ]);
    expect(logged).not.toContain("variant-secret");
  });
});
