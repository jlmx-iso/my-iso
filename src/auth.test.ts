import { describe, expect, it, vi } from "vitest";

// `next-auth` itself needs the Next.js runtime; only the configuration object
// handed to it is under test. The providers are the real ones.
vi.mock("next-auth", () => ({
  CredentialsSignin: class CredentialsSignin extends Error {},
  default: () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }),
}));
const findUser = vi.hoisted(() => vi.fn());
vi.mock("~/server/db", () => ({ db: { user: { findUnique: findUser } } }));
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

  describe("Google sign-in", () => {
    const google = { provider: "google", providerAccountId: "g-1", type: "oidc" as const };
    const user = { email: "Ada@Example.com", emailVerified: null, firstName: "Ada", id: "g-1", lastName: "L" };

    it("is refused unless Google says the email address is verified", async () => {
      const { authConfig } = await import("./auth");
      findUser.mockReset();

      for (const profile of [{ email_verified: false }, { email_verified: null }, {}, undefined]) {
        await expect(
          authConfig.callbacks.signIn({ account: google, profile, user }),
        ).resolves.toBe(false);
      }
      // Refused before any account lookup: an existing member's address
      // on an unverified Google account does not get in either.
      expect(findUser).not.toHaveBeenCalled();
    });

    it("is accepted for an existing member with a verified address", async () => {
      const { authConfig } = await import("./auth");
      findUser.mockReset();
      findUser.mockResolvedValue({ id: "user-1" });

      await expect(
        authConfig.callbacks.signIn({ account: google, profile: { email_verified: true }, user }),
      ).resolves.toBe(true);
      expect(findUser).toHaveBeenCalledWith({ where: { email: "ada@example.com" } });
    });
  });
});
