import { describe, expect, it, vi } from "vitest";

import { erasePostHogPerson, posthogAppHost, posthogErasureConfig } from "./posthogErasure";

describe("posthogAppHost", () => {
  it("maps PostHog Cloud ingestion hosts to their app host", () => {
    expect(posthogAppHost("https://us.i.posthog.com")).toBe("https://us.posthog.com");
    expect(posthogAppHost("https://eu.i.posthog.com")).toBe("https://eu.posthog.com");
  });

  it("keeps a self-hosted origin as it is", () => {
    expect(posthogAppHost("https://posthog.example.com/ingest")).toBe("https://posthog.example.com");
  });
});

describe("posthogErasureConfig", () => {
  it("is null unless both the key and the project are set", () => {
    expect(posthogErasureConfig({})).toBeNull();
    expect(posthogErasureConfig({ POSTHOG_PERSONAL_API_KEY: "phx_key" })).toBeNull();
    expect(posthogErasureConfig({ POSTHOG_PROJECT_ID: "12" })).toBeNull();
  });

  it("uses the region of POSTHOG_HOST, US Cloud by default", () => {
    expect(posthogErasureConfig({ POSTHOG_PERSONAL_API_KEY: "phx_key", POSTHOG_PROJECT_ID: "12" })).toEqual({
      apiKey: "phx_key",
      appHost: "https://us.posthog.com",
      projectId: "12",
    });
    expect(
      posthogErasureConfig({
        POSTHOG_HOST: "https://eu.i.posthog.com",
        POSTHOG_PERSONAL_API_KEY: "phx_key",
        POSTHOG_PROJECT_ID: "12",
      })?.appHost,
    ).toBe("https://eu.posthog.com");
  });

  it("reads the app's environment by default (unset in tests)", () => {
    expect(posthogErasureConfig()).toBeNull();
  });
});

describe("erasePostHogPerson", () => {
  const config = { apiKey: "phx_key", appHost: "https://eu.posthog.com", projectId: "12" };

  it("asks for the person, events and recordings to be deleted", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 202 }));
    await expect(erasePostHogPerson("user_1", config, fetchImpl)).resolves.toBe("requested");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://eu.posthog.com/api/projects/12/persons/bulk_delete/");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer phx_key");
    expect(JSON.parse(init.body as string)).toEqual({
      delete_events: true,
      delete_recordings: true,
      distinct_ids: ["user_1"],
    });
  });

  it("is skipped without configuration", async () => {
    const fetchImpl = vi.fn();
    await expect(erasePostHogPerson("user_1", null, fetchImpl)).resolves.toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(erasePostHogPerson("user_1")).resolves.toBe("skipped");
  });

  it("throws when PostHog refuses", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 403 }));
    await expect(erasePostHogPerson("user_1", config, fetchImpl)).rejects.toThrow(/HTTP 403/);
  });

  it("uses the global fetch by default", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 202 }));
    await expect(erasePostHogPerson("user_1", config)).resolves.toBe("requested");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
