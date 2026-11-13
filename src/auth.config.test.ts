import type { GoogleProfile } from "next-auth/providers/google";
import { describe, expect, it, vi } from "vitest";

import { googleIssuerOverride, googleProfileToUser } from "./auth.config";

describe("GOOGLE_OAUTH_ISSUER_URL", () => {
  it("is unused when unset", () => {
    expect(googleIssuerOverride(undefined, false)).toBeUndefined();
    expect(googleIssuerOverride("", true)).toBeUndefined();
  });

  it("is used as given for a loopback address", () => {
    for (const issuer of ["http://127.0.0.1:8789", "http://localhost:4000/oidc", "http://[::1]:9000"]) {
      expect(googleIssuerOverride(issuer, false)).toBe(issuer);
    }
  });

  it("may only point at this machine", () => {
    for (const issuer of ["https://accounts.example.com", "http://10.0.0.1:8789", "http://127.0.0.1.example.com"]) {
      expect(() => googleIssuerOverride(issuer, false)).toThrow("GOOGLE_OAUTH_ISSUER_URL may only point at localhost");
    }
    expect(() => googleIssuerOverride("not a url", false)).toThrow("GOOGLE_OAUTH_ISSUER_URL is not a valid URL");
  });

  it("is refused outright in a production deployment, loopback or not", () => {
    expect(() => googleIssuerOverride("http://127.0.0.1:8789", true)).toThrow(
      "GOOGLE_OAUTH_ISSUER_URL must not be set in production",
    );
  });

  it("is read from the environment, and counts a public origin as production", async () => {
    vi.stubEnv("GOOGLE_OAUTH_ISSUER_URL", "http://127.0.0.1:8789");
    vi.resetModules();
    const local = await import("./auth.config");
    expect(local.googleIssuerOverride()).toBe("http://127.0.0.1:8789");
    // The Google provider was built with it.
    const google = local.providers[0];
    expect(google && "options" in google ? google.options : undefined).toMatchObject({
      issuer: "http://127.0.0.1:8789",
    });

    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://app.example.com");
    vi.resetModules();
    await expect(import("./auth.config")).rejects.toThrow("must not be set in production");

    vi.unstubAllEnvs();
    vi.resetModules();
    const real = await import("./auth.config");
    const realGoogle = real.providers[0];
    expect(realGoogle && "options" in realGoogle ? realGoogle.options : undefined).not.toHaveProperty("issuer");
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
    const user = googleProfileToUser(profile);
    expect(user).toMatchObject({ email: "ada@example.com", firstName: "Ada", id: "g-1", lastName: "Lovelace" });
    expect(user.emailVerified).toBeInstanceOf(Date);
  });

  it("has an empty last name and no verification date when Google gives neither", () => {
    expect(
      googleProfileToUser({ ...profile, email_verified: false, family_name: undefined }),
    ).toMatchObject({ emailVerified: null, lastName: "" });
  });
});
