// Sign-in end to end inside Vitest: the real Auth.js request handler
// (@auth/core, which next-auth wraps for Next.js) running this app's
// configuration against a real SQLite database. Google sign-in goes through a
// local OpenID provider (src/test/helpers/oidcStub.ts) that the app is
// pointed at with GOOGLE_OAUTH_ISSUER_URL, so the whole round trip runs:
// discovery, authorize, token exchange, ID token checks, the callbacks, the
// adapter, the session cookie.

import { Auth } from "@auth/core";
import type { AdapterUser } from "next-auth/adapters";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETION_PENDING_MESSAGE, interpretOtpSignIn, otpOutcomeMessage } from "~/_utils/otp";
import type { ExtendedPrismaClient } from "~/server/_db/softDelete";
import { issueOtp } from "~/server/_db/verificationToken";
import type * as RateLimitModule from "~/server/_utils/rateLimit";
import { startOidcStub, stubSubject, type OidcStub, type OidcStubConsent } from "~/test/helpers/oidcStub";
import type * as RateLimitClockModule from "~/test/helpers/rateLimitClock";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

import type * as AuthModule from "./auth";

const state = vi.hoisted(() => ({
  db: undefined as ExtendedPrismaClient | undefined,
  inviteOnly: vi.fn<() => Promise<boolean | undefined>>(),
}));

// The app's `db` is the test database.
vi.mock("~/server/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return undefined;
        if (!state.db) throw new Error("test database not ready");
        return Reflect.get(state.db, prop) as unknown;
      },
    },
  ),
}));
// `next-auth` itself needs the Next.js runtime; @auth/core's `Auth` is the
// handler it wraps. Its error classes are the real ones, so Auth.js
// recognises the app's CredentialsSignin subclasses.
vi.mock("next-auth", async () => {
  const errors = await import("@auth/core/errors");
  return {
    CredentialsSignin: errors.CredentialsSignin,
    default: () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }),
  };
});
// The invite-only flag; PostHog itself is never called.
vi.mock("~/app/_lib/posthog", () => ({
  FeatureFlags: { INVITE_ONLY: "invite-only" },
  getFeatureFlagVariant: () => state.inviteOnly(),
}));

const ORIGIN = "http://localhost:3000";
const SECRET = "test-secret-that-is-at-least-32-chars-long!!!";
const IP = "203.0.113.9";
const CLIENT = { clientId: "test-google-client-id", clientSecret: "test-google-client-secret" };

// The limiter's clock is pinned to the start of a window, as
// freezeRateLimitClock does. By hand here: the modules are imported afresh
// below (once GOOGLE_OAUTH_ISSUER_URL is set), and the clock must be the one
// of the limiter instance the app code uses.
let nowMs = 0;
let epochMs = 0;
let restoreClock: () => void = () => undefined;
let RateLimits: typeof RateLimitModule.RateLimits;
let spendOtpVerifyLimit: typeof RateLimitClockModule.spendOtpVerifyLimit;

/** The cookies a browser would hold for the app's origin. */
class CookieJar {
  private readonly values = new Map<string, string>();

  header(): string {
    return [...this.values].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  get(name: string): string | undefined {
    return this.values.get(name);
  }

  store(response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = cookie.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
      if (expired || !value) this.values.delete(name);
      else this.values.set(name, value);
    }
  }
}

let testDb: TestDb;
let oidc: OidcStub;
let authConfig: typeof AuthModule.authConfig;

beforeAll(async () => {
  testDb = await createTestDb();
  state.db = testDb.db;
  oidc = await startOidcStub(CLIENT);
  // Read when src/auth.config.ts is first imported.
  vi.stubEnv("GOOGLE_OAUTH_ISSUER_URL", oidc.issuer);
  vi.resetModules();
  ({ authConfig } = await import("./auth"));
  const rateLimit = await import("~/server/_utils/rateLimit");
  const clock = await import("~/test/helpers/rateLimitClock");
  ({ RateLimits } = rateLimit);
  ({ spendOtpVerifyLimit } = clock);
  restoreClock = rateLimit.setRateLimitClock(() => nowMs);
  epochMs = clock.RATE_LIMIT_TEST_EPOCH_MS;
});

afterAll(async () => {
  restoreClock();
  vi.unstubAllEnvs();
  await oidc.close();
  await testDb.close();
});

beforeEach(async () => {
  nowMs = epochMs;
  const { raw } = testDb;
  await raw.rateLimit.deleteMany();
  await raw.verificationToken.deleteMany();
  await raw.pendingInviteValidation.deleteMany();
  await raw.inviteRedemption.deleteMany();
  await raw.account.deleteMany();
  await raw.inviteCode.deleteMany();
  await raw.user.deleteMany();
  state.inviteOnly.mockReset();
  state.inviteOnly.mockResolvedValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

/** One request to the app's Auth.js handler, as the browser in `jar` sends it. */
function authRequest(jar: CookieJar, path: string, init: { body?: URLSearchParams; headers?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers);
  headers.set("cookie", jar.header());
  headers.set("x-forwarded-for", IP);
  if (init.body) headers.set("content-type", "application/x-www-form-urlencoded");
  return Auth(
    new Request(new URL(path, ORIGIN), { body: init.body, headers, method: init.body ? "POST" : "GET" }),
    { ...authConfig, basePath: "/api/auth", secret: SECRET, trustHost: true },
  ).then((response) => {
    jar.store(response);
    return response;
  });
}

async function csrfToken(jar: CookieJar): Promise<string> {
  const response = await authRequest(jar, "/api/auth/csrf");
  const { csrfToken: token } = (await response.json()) as { csrfToken: string };
  return token;
}

async function session(jar: CookieJar) {
  const response = await authRequest(jar, "/api/auth/session");
  return (await response.json()) as { user?: Record<string, unknown> } | null;
}

/** Where a redirect from the app goes, relative to the app's origin when it stays there. */
function location(response: Response): string {
  const target = new URL(response.headers.get("location") ?? "", ORIGIN);
  return target.origin === ORIGIN ? `${target.pathname}${target.search}` : target.toString();
}

/** A member who validated an invite code on /join (or was approved from the waitlist). */
async function inviteAddress(email: string, options: { exhausted?: boolean } = {}) {
  const inviter = await createTestUser(testDb.db, { firstName: "Inviter" });
  const code = `ISO-INVIT-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  await testDb.db.inviteCode.create({
    data: { code, creatorId: inviter.id, currentRedemptions: options.exhausted ? 5 : 0, maxRedemptions: 5 },
  });
  await testDb.db.pendingInviteValidation.create({
    data: { code, email, expiresAt: new Date(Date.now() + 5 * 60 * 1000) },
  });
  return { code, inviter };
}

/** An account whose deletion has started (its row is hidden but still holds the address). */
async function deletingAccount(email: string) {
  const user = await createTestUser(testDb.db, { email });
  await testDb.raw.user.update({ data: { isDeleted: true }, where: { id: user.id } });
  return user;
}

describe("email-code sign-in (POST /api/auth/callback/otp)", () => {
  /** What next-auth/react's signIn("otp", { redirect: false }) resolves to. */
  async function signInWithCode(jar: CookieJar, email: string, code: string) {
    const token = await csrfToken(jar);
    const response = await authRequest(jar, "/api/auth/callback/otp", {
      body: new URLSearchParams({ callbackUrl: `${ORIGIN}/app`, code, csrfToken: token, email }),
      headers: { "x-auth-return-redirect": "1" },
    });
    const { url } = (await response.json()) as { url: string };
    const params = new URL(url).searchParams;
    const error = params.get("error");
    return { code: params.get("code"), error, ok: response.ok && !error, url };
  }

  it("signs a member in with the right code and starts a session with their profile", async () => {
    const member = await createTestUser(testDb.db, { email: "ada@example.com", firstName: "Ada", lastName: "Lovelace" });
    const code = await issueOtp(testDb.db, member.email);
    const jar = new CookieJar();

    const result = await signInWithCode(jar, "Ada@Example.com", code);

    expect(result).toMatchObject({ error: null, ok: true, url: `${ORIGIN}/app` });
    expect(interpretOtpSignIn(result, 0)).toEqual({ kind: "signed_in" });
    expect(jar.get("authjs.session-token")).toBeTruthy();
    await expect(session(jar)).resolves.toMatchObject({
      user: { email: "ada@example.com", firstName: "Ada", id: member.id, lastName: "Lovelace", name: "Ada Lovelace" },
    });
  });

  it("refuses a wrong code with the generic answer and no session", async () => {
    const member = await createTestUser(testDb.db, { email: "wrong@example.com" });
    await issueOtp(testDb.db, member.email, { code: "123456" });
    const jar = new CookieJar();

    const result = await signInWithCode(jar, member.email, "654321");

    expect(result).toMatchObject({ code: "credentials", error: "CredentialsSignin", ok: false });
    expect(interpretOtpSignIn(result, 0)).toMatchObject({ kind: "wrong_code" });
    expect(jar.get("authjs.session-token")).toBeUndefined();
    await expect(session(jar)).resolves.toBeNull();
  });

  it("refuses malformed input the same way", async () => {
    const result = await signInWithCode(new CookieJar(), "not-an-address", "12");
    expect(result).toMatchObject({ code: "credentials", error: "CredentialsSignin" });
  });

  it("answers rate_limited, without looking at the code, once over the limit", async () => {
    const member = await createTestUser(testDb.db, { email: "limited@example.com" });
    const code = await issueOtp(testDb.db, member.email, { code: "123456" });
    // Guesses from elsewhere have all but used up the address's window.
    await spendOtpVerifyLimit(testDb.db, RateLimits.OTP_VERIFY_EMAIL, IP, member.email, RateLimits.OTP_VERIFY_EMAIL.limit - 1);
    await expect(signInWithCode(new CookieJar(), member.email, "000000")).resolves.toMatchObject({ code: "credentials" });

    const result = await signInWithCode(new CookieJar(), member.email, code);

    expect(result).toMatchObject({ code: "rate_limited", error: "CredentialsSignin" });
    expect(otpOutcomeMessage(interpretOtpSignIn(result, 0))).toMatch(/Too many sign-in attempts/);
    // The code was not consumed: it works once the window has passed.
    nowMs += 24 * 60 * 60 * 1000;
    await expect(signInWithCode(new CookieJar(), member.email, code)).resolves.toMatchObject({ ok: true });
  });

  it("answers deletion_pending for the address of an account still being deleted", async () => {
    await deletingAccount("leaving@example.com");
    const code = await issueOtp(testDb.db, "leaving@example.com");

    const result = await signInWithCode(new CookieJar(), "leaving@example.com", code);

    expect(result).toMatchObject({ code: "deletion_pending", error: "CredentialsSignin" });
    expect(otpOutcomeMessage(interpretOtpSignIn(result, 0))).toBe(DELETION_PENDING_MESSAGE);
    await expect(testDb.raw.user.count({ where: { email: "leaving@example.com" } })).resolves.toBe(1);
  });

  it("creates the account of an invitee on their first code, redeeming the invite", async () => {
    const { code: inviteCode, inviter } = await inviteAddress("new@example.com");
    const code = await issueOtp(testDb.db, "new@example.com");
    const jar = new CookieJar();

    await expect(signInWithCode(jar, "new@example.com", code)).resolves.toMatchObject({ ok: true });

    const user = await testDb.db.user.findUniqueOrThrow({ where: { email: "new@example.com" } });
    expect(user.invitedByUserId).toBe(inviter.id);
    await expect(testDb.db.inviteCode.findUniqueOrThrow({ where: { code: inviteCode } })).resolves.toMatchObject({
      currentRedemptions: 1,
    });
    await expect(session(jar)).resolves.toMatchObject({ user: { id: user.id } });
  });

  it("refuses a new address without an invite while sign-up is invite-only", async () => {
    const code = await issueOtp(testDb.db, "uninvited@example.com");

    const result = await signInWithCode(new CookieJar(), "uninvited@example.com", code);

    expect(result).toMatchObject({ code: "credentials", error: "CredentialsSignin" });
    await expect(testDb.raw.user.count({ where: { email: "uninvited@example.com" } })).resolves.toBe(0);
  });

  it("lets anyone sign up while the invite-only flag is off", async () => {
    state.inviteOnly.mockResolvedValue(false);
    const code = await issueOtp(testDb.db, "open@example.com");

    await expect(signInWithCode(new CookieJar(), "open@example.com", code)).resolves.toMatchObject({ ok: true });
    await expect(testDb.db.user.count({ where: { email: "open@example.com" } })).resolves.toBe(1);
  });

  it("stays invite-only when the flag cannot be read", async () => {
    state.inviteOnly.mockRejectedValue(new Error("PostHog unreachable"));
    const code = await issueOtp(testDb.db, "flagless@example.com");

    const result = await signInWithCode(new CookieJar(), "flagless@example.com", code);

    expect(result).toMatchObject({ error: "CredentialsSignin" });
    await expect(testDb.raw.user.count({ where: { email: "flagless@example.com" } })).resolves.toBe(0);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("Google sign-in through the OpenID stub", () => {
  /**
   * The browser's round trip: the sign-in button, the provider's consent,
   * then the callback. Returns the app's last redirect.
   */
  async function signInWithGoogle(jar: CookieJar, consent: OidcStubConsent) {
    const token = await csrfToken(jar);
    const start = await authRequest(jar, "/api/auth/signin/google", {
      body: new URLSearchParams({ callbackUrl: `${ORIGIN}/app`, csrfToken: token }),
    });
    const authorize = new URL(start.headers.get("location") ?? "");
    expect(authorize.origin).toBe(oidc.issuer);

    // The consent page, then its form.
    const page = await fetch(authorize);
    expect(page.status).toBe(200);
    const form = new URLSearchParams(authorize.searchParams);
    form.set("email", consent.email);
    form.set("given_name", consent.givenName);
    if (consent.familyName) form.set("family_name", consent.familyName);
    if (consent.emailVerified !== false) form.set("email_verified", "true");
    const consentResponse = await fetch(new URL("/authorize", oidc.issuer), {
      body: form,
      method: "POST",
      redirect: "manual",
    });
    const callback = new URL(consentResponse.headers.get("location") ?? "");
    expect(callback.origin).toBe(ORIGIN);

    return authRequest(jar, `${callback.pathname}${callback.search}`);
  }

  it("signs an invitee up: User and Account rows, no OAuth tokens kept, and a session", async () => {
    const { inviter } = await inviteAddress("grace@example.com");
    const jar = new CookieJar();

    const response = await signInWithGoogle(jar, { email: "Grace@Example.com", familyName: "Hopper", givenName: "Grace" });

    expect(response.status).toBe(302);
    expect(location(response)).toBe("/app");
    const user = await testDb.db.user.findUniqueOrThrow({ where: { email: "grace@example.com" } });
    expect(user).toMatchObject({ firstName: "Grace", invitedByUserId: inviter.id, lastName: "Hopper" });
    const accounts = await testDb.db.account.findMany({ where: { userId: user.id } });
    expect(accounts).toEqual([
      expect.objectContaining({
        access_token: null,
        id_token: null,
        provider: "google",
        providerAccountId: stubSubject("grace@example.com"),
        refresh_token: null,
        type: "oidc",
      }),
    ]);
    await expect(session(jar)).resolves.toMatchObject({
      user: { email: "grace@example.com", firstName: "Grace", id: user.id, name: "Grace Hopper" },
    });
    // The provider was really used, end to end.
    expect(oidc.requests).toEqual(
      expect.arrayContaining(["GET /.well-known/openid-configuration", "POST /token"]),
    );
  });

  it("signs a returning member back in to the same account", async () => {
    await inviteAddress("linus@example.com");
    await signInWithGoogle(new CookieJar(), { email: "linus@example.com", givenName: "Linus" });

    const jar = new CookieJar();
    const response = await signInWithGoogle(jar, { email: "linus@example.com", givenName: "Linus" });

    expect(location(response)).toBe("/app");
    await expect(testDb.db.user.count({ where: { email: "linus@example.com" } })).resolves.toBe(1);
    await expect(testDb.db.account.count()).resolves.toBe(1);
    await expect(session(jar)).resolves.toMatchObject({ user: { email: "linus@example.com" } });
  });

  it("sends an address without an invite to /join with invite_required, creating nothing", async () => {
    const jar = new CookieJar();
    const response = await signInWithGoogle(jar, { email: "stranger@example.com", givenName: "Stranger" });

    expect(location(response)).toBe("/join?error=invite_required");
    await expect(testDb.raw.user.count()).resolves.toBe(0);
    await expect(testDb.raw.account.count()).resolves.toBe(0);
    await expect(session(jar)).resolves.toBeNull();
  });

  it("refuses the same way when the validated invite has run out since", async () => {
    await inviteAddress("late@example.com", { exhausted: true });

    const response = await signInWithGoogle(new CookieJar(), { email: "late@example.com", givenName: "Late" });

    expect(location(response)).toBe("/join?error=invite_required");
    await expect(testDb.raw.user.count({ where: { email: "late@example.com" } })).resolves.toBe(0);
  });

  it("sends the address of an account being deleted back to sign-in with deletion_pending", async () => {
    await deletingAccount("gone@example.com");

    const response = await signInWithGoogle(new CookieJar(), { email: "gone@example.com", givenName: "Gone" });

    expect(location(response)).toBe("/login?error=deletion_pending");
    await expect(testDb.raw.account.count()).resolves.toBe(0);
  });

  it("lets anyone sign up while the invite-only flag is off", async () => {
    state.inviteOnly.mockResolvedValue(false);

    const response = await signInWithGoogle(new CookieJar(), { email: "walkin@example.com", givenName: "Walk" });

    expect(location(response)).toBe("/app");
    await expect(testDb.db.user.findUniqueOrThrow({ where: { email: "walkin@example.com" } })).resolves.toMatchObject({
      firstName: "Walk",
      invitedByUserId: null,
      lastName: "",
    });
  });
});

describe("the jwt and session callbacks", () => {
  type JwtParams = Parameters<typeof AuthModule.authConfig.callbacks.jwt>[0];
  type SessionParams = Parameters<typeof AuthModule.authConfig.callbacks.session>[0];

  const jwt = (params: Record<string, unknown>) => authConfig.callbacks.jwt(params as unknown as JwtParams);
  const sessionOf = (token: Record<string, unknown>) =>
    authConfig.callbacks.session({
      session: { expires: "2030-01-01T00:00:00.000Z", user: {} },
      token,
    } as unknown as SessionParams);

  it("copies the profile into the token at sign-in, never the provider's access token", async () => {
    const member = await createTestUser(testDb.db, { firstName: "Ada", lastName: "Lovelace" });

    const token = await jwt({
      token: { accessToken: "ya29.secret", sub: member.id },
      user: { firstName: "Ada", id: member.id, image: "https://example.com/g.png", lastName: "Lovelace", profilePic: null },
    });

    expect(token).toEqual({
      firstName: "Ada",
      id: member.id,
      lastName: "Lovelace",
      name: "Ada Lovelace",
      picture: "https://example.com/g.png",
      profilePic: null,
      sub: member.id,
    });
  });

  it("falls back to the provider's display name when the profile has none", async () => {
    const member = await createTestUser(testDb.db, { firstName: "", lastName: "" });

    const token = await jwt({
      token: {},
      user: { firstName: "", id: member.id, lastName: "", name: "Display Name", profilePic: "https://res.cloudinary.com/test-cloud/p.jpg" },
    });

    expect(token).toMatchObject({ name: "Display Name", picture: "https://res.cloudinary.com/test-cloud/p.jpg" });
  });

  it("refreshes names and picture from the database when the session is updated", async () => {
    const member = await createTestUser(testDb.db, { firstName: "Old", lastName: "Name" });
    await testDb.db.user.update({ data: { firstName: "New", lastName: "Surname", profilePic: "pic.jpg" }, where: { id: member.id } });

    const token = await jwt({ token: { firstName: "Old", id: member.id, name: "Old Name" }, trigger: "update" });

    expect(token).toMatchObject({ firstName: "New", lastName: "Surname", name: "New Surname", picture: "pic.jpg", profilePic: "pic.jpg" });
  });

  it("keeps the old display name when the refreshed profile has no name", async () => {
    const member = await createTestUser(testDb.db, { firstName: "", lastName: "" });

    const token = await jwt({ token: { firstName: "Was", id: member.id, name: "Kept Name" }, trigger: "update" });

    expect(token).toMatchObject({ firstName: "", name: "Kept Name" });
  });

  it("backfills a token minted before the profile fields existed", async () => {
    const member = await createTestUser(testDb.db, { firstName: "Back", lastName: "Fill" });

    const token = await jwt({ token: { id: member.id, name: "x" } });

    expect(token).toMatchObject({ firstName: "Back", lastName: "Fill", name: "Back Fill" });
  });

  it("leaves a current token alone", async () => {
    const member = await createTestUser(testDb.db, { firstName: "Cur", lastName: "Rent" });
    const token = { firstName: "Cached", id: member.id, name: "Cached Name" };

    await expect(jwt({ token: { ...token } })).resolves.toEqual(token);
  });

  it("ends the session of an account that has been deleted since", async () => {
    const member = await deletingAccount("ended@example.com");

    await expect(jwt({ token: { firstName: "E", id: member.id } })).resolves.toBeNull();
    // And a sign-in completing for it at that moment.
    await expect(jwt({ token: {}, user: { firstName: "E", id: member.id } })).resolves.toBeNull();
  });

  it("maps the token onto the session", async () => {
    await expect(
      sessionOf({ firstName: "Ada", id: "user-1", lastName: "L", name: "Ada L", picture: "p.jpg", profilePic: "p.jpg" }),
    ).resolves.toMatchObject({
      user: { firstName: "Ada", id: "user-1", image: "p.jpg", lastName: "L", name: "Ada L", profilePic: "p.jpg" },
    });
  });

  it("uses safe defaults for fields the token lacks", async () => {
    const result = await sessionOf({ id: "user-1", name: 42, picture: null });
    expect(result.user).toMatchObject({ firstName: "", id: "user-1", image: undefined, lastName: "", name: undefined, profilePic: undefined });
  });

  it("refuses a token without a user id", async () => {
    await expect(sessionOf({ firstName: "No id" })).rejects.toThrow("Invalid session: missing user ID");
    expect(console.error).toHaveBeenCalled();
  });
});

describe("the signIn callback and the adapter", () => {
  type SignInParams = Parameters<typeof AuthModule.authConfig.callbacks.signIn>[0];

  it("refuses a sign-in without an email address", async () => {
    await expect(
      authConfig.callbacks.signIn({ account: null, user: { email: null } } as unknown as SignInParams),
    ).resolves.toBe(false);
  });

  it("refuses an email-code sign-up without an invite, without a redirect", async () => {
    await expect(
      authConfig.callbacks.signIn({
        account: { provider: "otp", providerAccountId: "x", type: "credentials" },
        user: { email: "nobody@example.com" },
      } as unknown as SignInParams),
    ).resolves.toBe(false);
  });

  /** What Auth.js hands the adapter: the provider's profile, which may lack the app's own fields. */
  function createUser(data: Record<string, unknown>) {
    const { adapter } = authConfig;
    if (!adapter.createUser) throw new Error("the adapter has no createUser");
    return adapter.createUser(data as unknown as AdapterUser);
  }

  it("creates a user only with an invite, taking the first name from the display name", async () => {
    const profile = { email: "Name@Example.com", emailVerified: null, id: "ignored", name: "First Last Extra" };

    await expect(createUser(profile)).rejects.toThrow("Sign-up requires a valid invite");

    await inviteAddress("name@example.com");
    await expect(createUser(profile)).resolves.toMatchObject({ email: "name@example.com", firstName: "First", lastName: "" });
  });

  it("creates a user with an empty first name when there is no name at all", async () => {
    state.inviteOnly.mockResolvedValue(false);

    await expect(
      createUser({ email: "anon@example.com", emailVerified: null, id: "x" }),
    ).resolves.toMatchObject({ firstName: "" });
  });
});
