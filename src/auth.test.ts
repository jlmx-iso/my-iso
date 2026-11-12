import { describe, expect, it, vi } from "vitest";

// `next-auth` itself needs the Next.js runtime; only the configuration object
// handed to it is under test. The providers are the real ones.
vi.mock("next-auth", () => ({
  CredentialsSignin: class CredentialsSignin extends Error {},
  default: () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }),
}));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/app/_lib/posthog", () => ({
  FeatureFlags: { INVITE_ONLY: "invite-only" },
  getFeatureFlagVariant: vi.fn(async () => true),
}));

describe("Auth.js configuration", () => {
  it("offers exactly Google and the email-code provider, even with a mail API key", async () => {
    // The removed magic-link provider used to appear whenever this was set.
    vi.stubEnv("RESEND_API_KEY", "re_test_placeholder");
    vi.resetModules();
    const { authConfig } = await import("./auth");

    const providers = authConfig.providers.map((provider) => {
      // Auth.js merges a provider's user options (the `otp` id) over its
      // defaults when it handles a request.
      const options: unknown = "options" in provider ? provider.options : undefined;
      const overriddenId =
        typeof options === "object" && options !== null && "id" in options ? options.id : undefined;
      const id = typeof overriddenId === "string" ? overriddenId : provider.id;
      return { id, type: provider.type };
    });

    expect(providers).toEqual([
      { id: "google", type: "oidc" },
      { id: "otp", type: "credentials" },
    ]);
    vi.unstubAllEnvs();
  });

  it("has no adapter methods for email (magic-link) providers", async () => {
    const { authConfig } = await import("./auth");

    expect(authConfig.adapter).toMatchObject({
      createVerificationToken: undefined,
      useVerificationToken: undefined,
    });
    // The rest of the adapter is intact.
    expect(authConfig.adapter).toHaveProperty("createUser", expect.any(Function));
  });
});
