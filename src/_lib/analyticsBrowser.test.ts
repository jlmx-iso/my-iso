import type { CaptureResult } from "posthog-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const posthog = vi.hoisted(() => ({
  __loaded: false,
  captureException: vi.fn(),
  has_opted_out_capturing: vi.fn(() => false),
  identify: vi.fn(),
  init: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  reset: vi.fn(),
  set_config: vi.fn(),
  startSessionRecording: vi.fn(),
  stopSessionRecording: vi.fn(),
}));

vi.mock("posthog-js", () => ({ default: posthog }));

import {
  beforeSend,
  buildPostHogConfig,
  captureBoundaryError,
  REPLAY_BLOCK_SELECTOR,
  setAnalyticsConsent,
  startAnalytics,
  syncAnalyticsUser,
} from "./analyticsBrowser";

/** A minimal browser: a cookie jar, localStorage and a navigator. */
function installBrowser(options: { cookie?: string; gpc?: boolean } = {}) {
  const cookies = new Map<string, string>();
  const jar = {
    get cookie() {
      return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    set cookie(value: string) {
      const [pair = "", ...attributes] = value.split(";").map((part) => part.trim());
      const [name = "", content = ""] = pair.split("=");
      if (attributes.includes("Max-Age=0")) cookies.delete(name);
      else cookies.set(name, content);
    },
  };
  if (options.cookie) jar.cookie = options.cookie;

  const storage = new Map<string, string>();
  vi.stubGlobal("document", jar);
  vi.stubGlobal("navigator", { globalPrivacyControl: options.gpc ?? false });
  vi.stubGlobal("location", { protocol: "https:" });
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => void storage.delete(key),
      setItem: (key: string, value: string) => void storage.set(key, value),
    },
  });
  return { jar, storage };
}

beforeEach(() => {
  // The module remembers the identified user in memory between calls;
  // a refusal is the public way to make it forget.
  installBrowser();
  setAnalyticsConsent("denied");
  vi.unstubAllGlobals();

  vi.clearAllMocks();
  posthog.__loaded = false;
  posthog.init.mockImplementation(() => {
    posthog.__loaded = true;
  });
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PUBLIC_KEY", "phc_test");
  vi.stubEnv("NEXT_PUBLIC_APP_ENV", "staging");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("startAnalytics", () => {
  it("starts PostHog for a visitor who has not been asked yet, without replay", () => {
    installBrowser();
    expect(startAnalytics()).toBe(true);

    expect(posthog.init).toHaveBeenCalledOnce();
    const [token, config] = posthog.init.mock.calls[0] as [string, ReturnType<typeof buildPostHogConfig>];
    expect(token).toBe("phc_test");
    expect(config.disable_session_recording).toBe(true);
    // Nothing is stored in the browser until consent is explicit.
    expect(config.persistence).toBe("memory");
  });

  it("lets PostHog use the browser's storage only with explicit consent", () => {
    installBrowser({ cookie: "iso_consent=granted" });
    startAnalytics();
    const [, config] = posthog.init.mock.calls[0] as [string, ReturnType<typeof buildPostHogConfig>];
    expect(config.persistence).toBe("localStorage+cookie");
  });

  it("allows replay only with explicit consent", () => {
    installBrowser({ cookie: "iso_consent=granted" });
    startAnalytics();
    const [, config] = posthog.init.mock.calls[0] as [string, ReturnType<typeof buildPostHogConfig>];
    expect(config.disable_session_recording).toBe(false);
  });

  it.each([
    ["the consent cookie says denied", { cookie: "iso_consent=denied" }],
    ["Global Privacy Control is on", { gpc: true }],
    ["GPC is on despite a granted cookie", { cookie: "iso_consent=granted", gpc: true }],
  ])("does not initialise the SDK at all when %s", (_name, options) => {
    installBrowser(options);
    expect(startAnalytics()).toBe(false);
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.opt_out_capturing).not.toHaveBeenCalled();
  });

  it("does nothing without a project token", () => {
    installBrowser();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PUBLIC_KEY", "");
    expect(startAnalytics()).toBe(false);
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it("initialises once", () => {
    installBrowser();
    startAnalytics();
    startAnalytics();
    expect(posthog.init).toHaveBeenCalledOnce();
  });
});

describe("buildPostHogConfig", () => {
  const config = buildPostHogConfig({ environment: "staging", sessionReplay: true, storage: true });

  it("sends everything to the app's own origin", () => {
    expect(config.api_host).toBe("/lens");
    expect(config.ui_host).toBe("https://us.posthog.com");
    expect(buildPostHogConfig({ environment: "x", sessionReplay: false, storage: false, uiHost: "https://eu.posthog.com" }).ui_host).toBe(
      "https://eu.posthog.com",
    );
  });

  it("keeps PostHog's state in memory without storage consent", () => {
    expect(config.persistence).toBe("localStorage+cookie");
    expect(buildPostHogConfig({ environment: "x", sessionReplay: false, storage: false }).persistence).toBe("memory");
  });

  it("captures App Router pageviews and exceptions, with identified-only profiles", () => {
    expect(config.capture_pageview).toBe("history_change");
    expect(config.capture_exceptions).toBe(true);
    expect(config.person_profiles).toBe("identified_only");
  });

  it("never asks PostHog for flags or surveys", () => {
    expect(config.advanced_disable_flags).toBe(true);
    expect(config.disable_surveys).toBe(true);
  });

  it("scrubs every event before it is sent", () => {
    expect(config.before_send).toBe(beforeSend);
  });

  it("masks all inputs and all text in replay, and blocks marked elements", () => {
    expect(config.session_recording?.maskAllInputs).toBe(true);
    expect(config.session_recording?.maskTextSelector).toBe("*");
    expect(config.session_recording?.blockSelector).toBe(REPLAY_BLOCK_SELECTOR);
    expect(REPLAY_BLOCK_SELECTOR).toBe("[data-replay-block]");
  });

  it("strips query strings from replay's page URLs and network entries", () => {
    const mask = config.session_recording?.maskCapturedNetworkRequestFn;
    const entry = { duration: 1, entryType: "navigation", name: "https://myiso.app/join?code=ISO-TEST-ABCDEFGH", startTime: 0 };
    expect(mask?.(entry)).toEqual({ ...entry, name: "https://myiso.app/join" });
  });

  it("tags events with the environment once loaded", () => {
    const register = vi.fn();
    config.loaded?.({ register } as unknown as Parameters<NonNullable<typeof config.loaded>>[0]);
    expect(register).toHaveBeenCalledWith({ environment: "staging" });
  });
});

describe("beforeSend", () => {
  const event = (overrides: Partial<CaptureResult>): CaptureResult => ({
    event: "$pageview",
    properties: {},
    uuid: "u",
    ...overrides,
  });

  it("removes the waitlist email and the invite code from a pageview", () => {
    const waitlist = beforeSend(
      event({
        $set_once: { $initial_current_url: "https://myiso.app/join?waitlist=approved&email=a@b.co" },
        properties: {
          $current_url: "https://myiso.app/join?waitlist=approved&email=a@b.co",
          $pathname: "/join",
          $referrer: "https://myiso.app/join?code=ISO-TEST-ABCDEFGH",
        },
      }),
    );
    expect(JSON.stringify(waitlist)).not.toMatch(/@|code=|ISO-TEST|email=|waitlist=/);
    expect(waitlist?.properties.$current_url).toBe("https://myiso.app/join");
    expect(waitlist?.properties.$pathname).toBe("/join");
    expect(waitlist?.$set_once?.$initial_current_url).toBe("https://myiso.app/join");
  });

  it("keeps the event's identity and the person properties set on purpose", () => {
    const identify = beforeSend(
      event({ $set: { email: "sarah@example.com", name: "Sarah" }, event: "$identify", properties: { distinct_id: "user_1" } }),
    );
    expect(identify?.event).toBe("$identify");
    expect(identify?.uuid).toBe("u");
    expect(identify?.properties.distinct_id).toBe("user_1");
    expect(identify?.$set).toEqual({ email: "sarah@example.com", name: "Sarah" });
  });

  it("passes a dropped event through as dropped", () => {
    expect(beforeSend(null)).toBeNull();
  });
});

describe("setAnalyticsConsent", () => {
  it("denied mid-session: records it, stops replay, drops the identity, opts out", () => {
    const { jar, storage } = installBrowser();
    startAnalytics();
    syncAnalyticsUser({ id: "user_1" });
    vi.clearAllMocks();

    setAnalyticsConsent("denied");

    expect(jar.cookie).toContain("iso_consent=denied");
    expect(posthog.stopSessionRecording).toHaveBeenCalledOnce();
    expect(posthog.reset).toHaveBeenCalledOnce();
    expect(posthog.opt_out_capturing).toHaveBeenCalledOnce();
    expect(storage.size).toBe(0);

    // And nothing identifies the visitor again afterwards.
    syncAnalyticsUser({ id: "user_1" });
    expect(posthog.identify).not.toHaveBeenCalled();
  });

  it("denied before anything started: nothing is started", () => {
    installBrowser();
    setAnalyticsConsent("denied");
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.opt_out_capturing).not.toHaveBeenCalled();
  });

  it("granted: starts analytics if needed and turns replay on", () => {
    const { jar } = installBrowser({ cookie: "iso_consent=denied" });
    expect(startAnalytics()).toBe(false);

    posthog.has_opted_out_capturing.mockReturnValueOnce(true);
    setAnalyticsConsent("granted");

    expect(jar.cookie).toContain("iso_consent=granted");
    expect(posthog.init).toHaveBeenCalledOnce();
    expect(posthog.opt_in_capturing).toHaveBeenCalledOnce();
    expect(posthog.startSessionRecording).toHaveBeenCalledOnce();
  });

  it("granted does not override Global Privacy Control", () => {
    installBrowser({ gpc: true });
    setAnalyticsConsent("granted");
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.startSessionRecording).not.toHaveBeenCalled();
  });

  it("unknown: forgets the choice and keeps replay off", () => {
    const { jar } = installBrowser({ cookie: "iso_consent=granted" });
    startAnalytics();
    setAnalyticsConsent("unknown");
    expect(jar.cookie).not.toContain("iso_consent");
    expect(posthog.stopSessionRecording).toHaveBeenCalledOnce();
  });

  it("granted mid-session: moves PostHog and the identified user into the browser's storage", () => {
    const { storage } = installBrowser();
    startAnalytics();
    syncAnalyticsUser({ id: "user_1" });
    expect(storage.size).toBe(0);

    setAnalyticsConsent("granted");

    expect(posthog.set_config).toHaveBeenCalledExactlyOnceWith({ persistence: "localStorage+cookie" });
    expect(storage.get("iso_analytics_user")).toBe("user_1");
    // Not re-initialised: the running SDK switches over.
    expect(posthog.init).toHaveBeenCalledOnce();
  });

  it("granted before anything started: starts with storage, no switch needed", () => {
    installBrowser({ cookie: "iso_consent=denied" });
    setAnalyticsConsent("granted");
    const [, config] = posthog.init.mock.calls[0] as [string, ReturnType<typeof buildPostHogConfig>];
    expect(config.persistence).toBe("localStorage+cookie");
    expect(posthog.set_config).not.toHaveBeenCalled();
  });

  it("unknown after granted: back to memory, nothing left in storage", () => {
    const { storage } = installBrowser({ cookie: "iso_consent=granted" });
    startAnalytics();
    syncAnalyticsUser({ id: "user_1" });
    expect(storage.get("iso_analytics_user")).toBe("user_1");

    setAnalyticsConsent("unknown");

    expect(posthog.set_config).toHaveBeenCalledExactlyOnceWith({ persistence: "memory" });
    expect(storage.size).toBe(0);
    // The identity is still known for this page: sign-out still resets it.
    syncAnalyticsUser(null);
    expect(posthog.reset).toHaveBeenCalledOnce();
  });
});

describe("syncAnalyticsUser", () => {
  it("identifies by user id only, without person properties, until consent is explicit", () => {
    const { storage } = installBrowser();
    startAnalytics();
    syncAnalyticsUser({ email: "sarah@example.com", id: "user_1", name: "Sarah" });
    expect(posthog.identify).toHaveBeenCalledExactlyOnceWith("user_1");
    // Remembered for this page only, not in the browser's storage.
    expect(storage.size).toBe(0);
  });

  it("adds email and name with explicit consent", () => {
    installBrowser({ cookie: "iso_consent=granted" });
    startAnalytics();
    syncAnalyticsUser({ email: "sarah@example.com", id: "user_1", name: "Sarah" });
    expect(posthog.identify).toHaveBeenCalledExactlyOnceWith("user_1", {
      email: "sarah@example.com",
      name: "Sarah",
    });
  });

  it("resets on sign-out, once", () => {
    installBrowser();
    startAnalytics();
    syncAnalyticsUser({ id: "user_1" });
    syncAnalyticsUser(null);
    syncAnalyticsUser(null);
    expect(posthog.reset).toHaveBeenCalledOnce();
  });

  it("does not reset a visitor who was never identified", () => {
    installBrowser();
    startAnalytics();
    syncAnalyticsUser(null);
    expect(posthog.reset).not.toHaveBeenCalled();
  });

  it("resets before identifying a different user on the same browser", () => {
    installBrowser();
    startAnalytics();
    syncAnalyticsUser({ id: "user_1" });
    syncAnalyticsUser({ id: "user_2" });
    expect(posthog.reset).toHaveBeenCalledOnce();
    expect(posthog.identify).toHaveBeenLastCalledWith("user_2");
  });

  it("does nothing while PostHog is not running", () => {
    installBrowser({ gpc: true });
    startAnalytics();
    syncAnalyticsUser({ id: "user_1" });
    captureBoundaryError(new Error("x"), "error");
    expect(posthog.identify).not.toHaveBeenCalled();
    expect(posthog.captureException).not.toHaveBeenCalled();
  });
});

describe("captureBoundaryError", () => {
  it("reports the error with the boundary it was caught by", () => {
    installBrowser();
    startAnalytics();
    const error = new Error("render failed");
    captureBoundaryError(error, "global-error");
    expect(posthog.captureException).toHaveBeenCalledWith(error, { boundary: "global-error" });
  });
});
