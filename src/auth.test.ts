import { describe, expect, it, vi } from "vitest";

import type * as AuthModule from "./auth";

// `next-auth` itself needs the Next.js runtime; only the configuration object
// handed to it is under test. The providers are the real ones.
vi.mock("next-auth", () => ({
  CredentialsSignin: class CredentialsSignin extends Error {},
  default: () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }),
}));
const findUser = vi.hoisted(() => vi.fn());
const countUsers = vi.hoisted(() => vi.fn(async () => 0));
const createAccount = vi.hoisted(() => vi.fn(async (args: { data: unknown }) => args.data));
vi.mock("~/server/db", () => ({ db: { account: { create: createAccount }, user: { count: countUsers, findUnique: findUser } } }));
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

  it("links a Google account without storing its OAuth tokens", async () => {
    const { authConfig } = await import("./auth");
    createAccount.mockClear();
    await authConfig.adapter.linkAccount?.({
      access_token: "ya29.secret",
      expires_at: 1,
      id_token: "eyJ.secret",
      provider: "google",
      providerAccountId: "g-1",
      refresh_token: "1//secret",
      scope: "openid email",
      token_type: "bearer",
      type: "oidc",
      userId: "user-1",
    });
    const stored = createAccount.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(JSON.stringify(stored)).not.toMatch(/secret/);
    expect(stored).toMatchObject({ provider: "google", providerAccountId: "g-1", userId: "user-1" });
  });

  describe("sessions of deleted accounts", () => {
    type JwtParams = Parameters<typeof AuthModule.authConfig.callbacks.jwt>[0];

    it("ends the session of an account that is gone or being deleted", async () => {
      const { authConfig } = await import("./auth");
      findUser.mockReset();
      findUser.mockResolvedValue(null);

      const token = { firstName: "Ada", id: "user-1" };
      await expect(authConfig.callbacks.jwt({ token } as unknown as JwtParams)).resolves.toBeNull();
      expect(findUser).toHaveBeenCalledWith({ select: { id: true }, where: { id: "user-1" } });
    });

    it("keeps the session of a live account", async () => {
      const { authConfig } = await import("./auth");
      findUser.mockReset();
      findUser.mockResolvedValue({ id: "user-1" });

      const token = { firstName: "Ada", id: "user-1" };
      await expect(authConfig.callbacks.jwt({ token } as unknown as JwtParams)).resolves.toMatchObject({
        id: "user-1",
      });
    });

    it("keeps the session when the check itself fails", async () => {
      const { authConfig } = await import("./auth");
      findUser.mockReset();
      findUser.mockRejectedValue(new Error("D1 unavailable"));

      const token = { firstName: "Ada", id: "user-1" };
      await expect(authConfig.callbacks.jwt({ token } as unknown as JwtParams)).resolves.toMatchObject({
        id: "user-1",
      });
    });
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

    it("sends the address of an account still being deleted back to sign-in with an explanation", async () => {
      const { authConfig } = await import("./auth");
      findUser.mockReset();
      findUser.mockResolvedValue(null);
      countUsers.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

      await expect(
        authConfig.callbacks.signIn({ account: google, profile: { email_verified: true }, user }),
      ).resolves.toBe("/login?error=deletion_pending");
      await expect(
        authConfig.callbacks.signIn({ account: { ...google, provider: "otp", type: "credentials" }, user }),
      ).resolves.toBe(false);
    });
  });
});
