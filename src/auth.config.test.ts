import type { GoogleProfile } from "next-auth/providers/google";
import { describe, expect, it, vi } from "vitest";

const captureServerException = vi.hoisted(() => vi.fn());
vi.mock("~/server/_lib/posthog", () => ({ captureServerException }));

import authConfig, { googleIssuerOverride, googleProfileToUser, pages } from "./auth.config";

describe("GOOGLE_OAUTH_ISSUER_URL", () => {
  const neverReported = () => {
    throw new Error("reported outside production");
  };

  it("is unused when unset, and then reports nothing even in production", () => {
    expect(googleIssuerOverride(undefined, false, neverReported)).toBeUndefined();
    expect(googleIssuerOverride("", true, neverReported)).toBeUndefined();
  });

  it("is used as given for a loopback address", () => {
    for (const issuer of ["http://127.0.0.1:8789", "http://localhost:4000/oidc", "http://[::1]:9000"]) {
      expect(googleIssuerOverride(issuer, false, neverReported)).toBe(issuer);
    }
  });

  it("may only point at this machine outside production", () => {
    for (const issuer of ["https://accounts.example.com", "http://10.0.0.1:8789", "http://127.0.0.1.example.com"]) {
      expect(() => googleIssuerOverride(issuer, false, neverReported)).toThrow(
        "GOOGLE_OAUTH_ISSUER_URL may only point at localhost",
      );
    }
    expect(() => googleIssuerOverride("not a url", false, neverReported)).toThrow(
      "GOOGLE_OAUTH_ISSUER_URL is not a valid URL",
    );
  });

  it("is ignored in a production deployment, loopback or not, and reported", () => {
    const report = vi.fn();

    expect(googleIssuerOverride("http://127.0.0.1:8789", true, report)).toBeUndefined();
    expect(googleIssuerOverride("https://evil.example", true, report)).toBeUndefined();

    expect(report).toHaveBeenCalledTimes(2);
  });

  it("is read from the environment; a production deployment keeps Google and reports it once", async () => {
    vi.stubEnv("GOOGLE_OAUTH_ISSUER_URL", "http://127.0.0.1:8789");
    vi.resetModules();
    const local = await import("./auth.config");
    expect(local.googleIssuerOverride()).toBe("http://127.0.0.1:8789");
    // The Google provider was built with it.
    const google = local.providers[0];
    expect(google && "options" in google ? google.options : undefined).toMatchObject({
      issuer: "http://127.0.0.1:8789",
    });

    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    captureServerException.mockClear();
    vi.stubEnv("APP_ENV", "production");
    vi.resetModules();
    const deployed = await import("./auth.config");
    const deployedGoogle = deployed.providers[0];
    expect(deployedGoogle && "options" in deployedGoogle ? deployedGoogle.options : undefined).not.toHaveProperty(
      "issuer",
    );
    expect(captureServerException).toHaveBeenCalledExactlyOnceWith(
      new Error("GOOGLE_OAUTH_ISSUER_URL ignored in production"),
      { source: "auth.config" },
    );
    expect(String(errors.mock.calls[0]?.[0])).toContain("GOOGLE_OAUTH_ISSUER_URL ignored in production");
    errors.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe("the shared configuration", () => {
  it("sends refused and failed sign-ins to /login, for the middleware's instance too", () => {
    expect(pages).toEqual({ error: "/login", signIn: "/login" });
    expect(authConfig.pages).toBe(pages);
  });
});

describe("the Google profile", () => {
  const profile = {
    email: "ada@example.com",
    email_verified: true,
    family_name: "Lovelace",
    given_name: "Ada",
    sub: "g-1",
  } as GoogleProfile;

  it("becomes the app's user fields", () => {
    expect(googleProfileToUser(profile)).toEqual({
      email: "ada@example.com",
      firstName: "Ada",
      id: "g-1",
      lastName: "Lovelace",
    });
  });

  it("has an empty last name when Google gives none", () => {
    expect(googleProfileToUser({ ...profile, family_name: undefined })).toMatchObject({ lastName: "" });
  });
});
