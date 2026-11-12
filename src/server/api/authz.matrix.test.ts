/**
 * Authorization matrix: who may reach every tRPC procedure.
 *
 * POLICY below has one row per procedure in the app router. The test walks
 * the router itself, so a procedure added without a row (or a row left
 * behind by a removed procedure) fails. Each procedure is then called with a
 * minimal valid input as each kind of caller, against a real SQLite
 * database, and the outcome must match its row:
 *
 *   access    anonymous   member      Pro member  founder / ambassador
 *   public    reaches     reaches     reaches     reaches
 *   member    UNAUTHORIZED reaches    reaches     reaches
 *   pro       UNAUTHORIZED FORBIDDEN  reaches     reaches
 *   admin     UNAUTHORIZED FORBIDDEN  FORBIDDEN   reaches
 *
 * "member" is protectedProcedure, "pro" proProcedure, "admin"
 * founderProcedure (roles in ADMIN_ROLES), all in src/server/api/trpc.ts.
 * "Reaches" means the call got past the procedure's gate: it may still fail
 * on its own terms (NOT_FOUND for the made-up ids used here, a business
 * rule), but not with the gate's error, and not on input validation (the
 * inputs must stay valid).
 *
 * A resolver may itself answer UNAUTHORIZED or FORBIDDEN for the minimal
 * input (for instance "not a participant of this thread"): the row must say
 * so in `resolverDenies`, so object-level checks are visible here too.
 *
 * Changing a row's `access` is a security decision. See docs/TESTING.md.
 */
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { hasProAccess } from "~/server/_billing/entitlements";
import type * as StripeModule from "~/server/_billing/stripe";
import type * as PosthogModule from "~/server/_lib/posthog";
import { USER_ROLES } from "~/server/_utils/roles";
import { createDbCaller } from "~/test/helpers/dbCaller";
import { freezeRateLimitClock } from "~/test/helpers/rateLimitClock";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";
import { startStripeStub, type StripeStub } from "~/test/helpers/stripeStub";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("~/_lib", () => ({ cloudinaryClient: null }));
vi.mock("~/server/_lib/posthog", async (importOriginal) => ({
  ...(await importOriginal<typeof PosthogModule>()),
  captureEvent: vi.fn(),
  captureServerException: vi.fn(),
  getFeatureFlag: vi.fn(async () => undefined),
}));
vi.mock("~/server/_lib/google", () => ({
  placeAutocomplete: vi.fn(async () => ({ isErr: false, isOk: true, value: [] })),
}));

// Billing procedures talk to the real Stripe SDK pointed at a local stub.
const stripeRef = vi.hoisted((): { stub: { client: unknown } | null } => ({ stub: null }));
vi.mock("~/server/_billing/stripe", async (importOriginal) => {
  const client = () => {
    if (!stripeRef.stub) throw new Error("the Stripe stub is not running");
    return stripeRef.stub.client;
  };
  return {
    ...(await importOriginal<typeof StripeModule>()),
    getAccessCheckStripe: client,
    getStripe: client,
  };
});

import { appRouter } from "./root";

type Access = "public" | "member" | "pro" | "admin";

type Row = {
  access: Access;
  /** A minimal input that passes the procedure's schema. */
  input?: unknown;
  /**
   * The resolver itself answers UNAUTHORIZED/FORBIDDEN for this input to
   * callers the gate lets through; why.
   */
  resolverDenies?: string;
};

const MISSING = "missing-id";
const FUTURE = new Date(Date.UTC(2031, 5, 1)).toISOString();
const SOCIALS = { facebook: null, instagram: null, tiktok: null, twitter: null, vimeo: null, website: null, youtube: null };

// One row per procedure, grouped by router as in src/server/api/routers.
const POLICY: Record<string, Row> = {
  // auth: sign-in for the mobile app, before there is a session.
  "auth.exchangeMobileToken": { access: "public", input: { idToken: "not-a-real-token" } },
  "auth.requestMobileOtp": { access: "public", input: { email: "otp@example.com" } },
  "auth.verifyMobileOtp": {
    access: "public",
    input: { code: "123456", email: "otp@example.com" },
    resolverDenies: "a wrong code is UNAUTHORIZED: that is the procedure's answer, not a gate",
  },

  "booking.applyToEvent": { access: "member", input: { eventId: MISSING } },
  "booking.getByEventId": { access: "member", input: { eventId: MISSING } },
  "booking.getMyApplications": { access: "member", input: {} },
  "booking.getMyApplicationsPage": { access: "member", input: {} },
  "booking.getReceivedApplications": { access: "member", input: {} },
  "booking.getReceivedApplicationsPage": { access: "member", input: {} },
  "booking.hasApplied": { access: "member", input: { eventId: MISSING } },
  "booking.updateStatus": { access: "member", input: { bookingId: MISSING, status: "accepted" } },

  "discover.expireStaleMatches": { access: "member" },
  "discover.getCardDeck": { access: "member", input: {} },
  "discover.getMatchById": { access: "member", input: { matchId: MISSING } },
  "discover.getMatches": { access: "member", input: {} },
  "discover.getPreferences": { access: "member" },
  "discover.swipe": { access: "member", input: { direction: "pass", targetId: MISSING } },
  "discover.updatePreferences": { access: "member", input: {} },

  "event.addCommentToEvent": { access: "member", input: { content: "Hi", eventId: MISSING } },
  "event.addLikeToEvent": { access: "member", input: { targetId: MISSING } },
  "event.addOrRemoveEventCommentLike": { access: "member", input: { targetId: MISSING } },
  "event.create": {
    access: "member",
    input: { date: FUTURE, description: "Second shooter", duration: 4, location: "Austin, TX", title: "Wedding" },
  },
  "event.delete": { access: "member", input: { id: MISSING } },
  "event.deleteCommentFromEvent": { access: "member", input: { id: MISSING } },
  "event.getById": { access: "member", input: { id: MISSING } },
  "event.getByPhotographerId": { access: "member", input: { photographerId: MISSING } },
  "event.getCommentById": { access: "member", input: { id: MISSING } },
  "event.getCommentCountByEventId": { access: "member", input: { eventId: MISSING } },
  "event.getCommentsByEventId": { access: "member", input: { eventId: MISSING } },
  "event.getCommentsPage": { access: "member", input: { eventId: MISSING } },
  "event.getFeedPage": { access: "member", input: {} },
  "event.getRecentByLocation": { access: "member", input: { locations: ["Austin, TX"] } },
  "event.removeLikeFromEvent": { access: "member", input: { targetId: MISSING } },
  "event.search": {
    access: "member",
    input: { afterDate: new Date(Date.UTC(2030, 0, 1)), beforeDate: new Date(Date.UTC(2032, 0, 1)), query: "wedding" },
  },
  "event.update": { access: "member", input: { id: MISSING, title: "Renamed" } },

  "google.getAutocompleteLocations": { access: "member", input: { query: "Austin" } },

  // invite: checking a code and preparing sign-up come before an account.
  "invite.getMyCode": { access: "member" },
  "invite.prepareRegistration": { access: "public", input: { code: "ISO-NOPE-AAAAAAAA", email: "new@example.com" } },
  "invite.redeem": { access: "member", input: { code: "ISO-NOPE-AAAAAAAA" } },
  "invite.regenerate": { access: "member" },
  "invite.validate": { access: "public", input: { code: "ISO-NOPE-AAAAAAAA" } },

  "message.create": {
    access: "member",
    input: { content: "Hello", threadId: MISSING },
    resolverDenies: "FORBIDDEN 'Not a participant of this thread' for a thread the caller is not in",
  },
  "message.createThread": {
    access: "member",
    input: { initialMessage: "Hello", participants: [MISSING] },
    resolverDenies: "FORBIDDEN `recipient_not_messageable` without a match or booking with the recipient",
  },
  "message.delete": { access: "member", input: { id: MISSING } },
  "message.getLatestThreadByUserId": { access: "member" },
  "message.getLatestThreadMessage": { access: "member", input: { threadId: MISSING } },
  "message.getPotentialRecipients": { access: "member", input: { query: "Ann" } },
  "message.getRecipientById": {
    access: "member",
    input: { userId: MISSING },
    resolverDenies: "FORBIDDEN `recipient_not_messageable` without a match or booking with the person",
  },
  "message.getThreadById": { access: "member", input: { threadId: MISSING } },
  "message.getThreadByParticipants": { access: "member", input: { participants: [MISSING] } },
  "message.getThreadsByUserId": { access: "member", input: {} },
  "message.getThreadsPage": { access: "member", input: {} },
  "message.getUnreadCount": { access: "member" },
  "message.markThreadRead": {
    access: "member",
    input: { threadId: MISSING },
    resolverDenies: "FORBIDDEN 'Not a participant of this thread' for a thread the caller is not in",
  },

  "notification.getAll": { access: "member", input: {} },
  "notification.getUnreadCount": { access: "member" },
  "notification.markAllAsRead": { access: "member" },
  "notification.markAsRead": { access: "member", input: { notificationId: MISSING } },

  // photographer: public profile pages read these without a session.
  "photographer.addPortfolioImage": {
    access: "member",
    input: { image: "data:image/png;base64,iVBORw0KGgo=", title: "Portrait" },
  },
  "photographer.count": { access: "member" },
  "photographer.create": {
    access: "member",
    input: { ...SOCIALS, companyName: "Studio", location: "Austin, TX", name: "Ann Lee" },
  },
  "photographer.deletePortfolioImage": { access: "member", input: { id: MISSING } },
  "photographer.getById": { access: "member", input: { id: MISSING } },
  "photographer.getByUserId": { access: "member", input: { userId: MISSING } },
  "photographer.getByUsername": { access: "public", input: { username: "nobody-here" } },
  "photographer.getPortfolioImages": { access: "public", input: { photographerId: MISSING } },
  "photographer.reorderPortfolioImages": { access: "member", input: { images: [{ id: MISSING, sortOrder: 0 }] } },
  "photographer.update": {
    access: "member",
    input: { ...SOCIALS, bio: null, companyName: "Studio", firstName: "Ann", id: MISSING, lastName: "Lee", location: "Austin, TX" },
  },
  "photographer.updatePortfolioImage": { access: "member", input: { id: MISSING, title: "New" } },
  "photographer.uploadProfileImage": { access: "member", input: { image: "data:image/png;base64,iVBORw0KGgo=" } },

  // review: a photographer's reviews and rating are on the public profile.
  "review.create": { access: "member", input: { photographerId: MISSING, rating: 5, title: "Great" } },
  "review.delete": { access: "member", input: { id: MISSING } },
  "review.getAverageRating": { access: "public", input: { photographerId: MISSING } },
  "review.getByPhotographerId": { access: "public", input: { photographerId: MISSING } },
  "review.getMyReviewState": { access: "member", input: { photographerId: MISSING } },
  "review.getPageByPhotographerId": { access: "public", input: { photographerId: MISSING } },

  "search.searchAll": { access: "member", input: { query: "wedding" } },

  // subscription: buying Pro must not need Pro. Re-sync is an admin tool.
  "subscription.createCheckoutSession": { access: "member", input: { billingInterval: "monthly" } },
  "subscription.createPortalSession": { access: "member" },
  "subscription.getPricing": { access: "member" },
  "subscription.getStatus": { access: "member" },
  "subscription.resyncFromStripe": { access: "admin", input: {} },
  "subscription.syncStatus": { access: "member" },

  "user.addFavorite": { access: "member", input: { photographerId: MISSING } },
  "user.getFavorites": { access: "member", input: {} },
  "user.getMe": { access: "member" },
  "user.isFavorite": { access: "member", input: { targetId: MISSING } },
  "user.isHandleAvailable": { access: "member", input: { handle: "ann-lee" } },
  "user.removeFavorite": { access: "member", input: { photographerId: MISSING } },
  "user.updateProfile": { access: "member", input: {} },

  // waitlist: anyone may join; reviewing it is for founders and ambassadors.
  "waitlist.approve": { access: "admin", input: { id: MISSING } },
  "waitlist.getAll": { access: "admin", input: {} },
  "waitlist.reject": { access: "admin", input: { id: MISSING } },
  "waitlist.submit": { access: "public", input: { email: "waiting@example.com", name: "Wait Ing" } },
};

type CallerKind = "anonymous" | "member" | "pro" | "founder" | "ambassador";
const CALLERS: CallerKind[] = ["anonymous", "member", "pro", "founder", "ambassador"];

/** What each kind of caller gets from a procedure of each access level. */
const EXPECTED: Record<Access, Record<CallerKind, Outcome>> = {
  admin: { ambassador: "reaches", anonymous: "UNAUTHORIZED", founder: "reaches", member: "FORBIDDEN", pro: "FORBIDDEN" },
  member: { ambassador: "reaches", anonymous: "UNAUTHORIZED", founder: "reaches", member: "reaches", pro: "reaches" },
  pro: { ambassador: "reaches", anonymous: "UNAUTHORIZED", founder: "reaches", member: "FORBIDDEN", pro: "reaches" },
  public: { ambassador: "reaches", anonymous: "reaches", founder: "reaches", member: "reaches", pro: "reaches" },
};

type Outcome = "reaches" | "UNAUTHORIZED" | "FORBIDDEN" | "INVALID_INPUT";

type Observed = { code?: string; message?: string; outcome: Outcome };

const procedurePaths = Object.keys(appRouter._def.procedures).sort();

/** Calls `procedurePath` and sorts the result into an Outcome. */
async function call(caller: unknown, procedurePath: string, input: unknown): Promise<Observed> {
  const fn = procedurePath
    .split(".")
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], caller) as (
    input: unknown,
  ) => Promise<unknown>;
  try {
    await fn(input);
    return { outcome: "reaches" };
  } catch (error) {
    if (!(error instanceof TRPCError)) throw error;
    const observed = { code: error.code, message: error.message };
    if (error.cause instanceof ZodError) return { ...observed, outcome: "INVALID_INPUT" };
    if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
      return { ...observed, outcome: error.code };
    }
    return { ...observed, outcome: "reaches" };
  }
}

/**
 * The gates' own errors (src/server/api/trpc.ts). A row with
 * `resolverDenies` may get UNAUTHORIZED/FORBIDDEN from its resolver; it must
 * still never get one of these when its access level lets the caller in.
 */
function isGateError(observed: Observed): boolean {
  return (
    (observed.code === "UNAUTHORIZED" && observed.message === "UNAUTHORIZED") ||
    (observed.code === "FORBIDDEN" &&
      (observed.message === "Founder or ambassador access is required." ||
        (observed.message ?? "").startsWith("An active Pro subscription is required")))
  );
}

freezeRateLimitClock();

let stub: StripeStub;
let testDb: TestDb;
const callers = {} as Record<CallerKind, unknown>;

beforeAll(async () => {
  stub = await startStripeStub();
  stripeRef.stub = stub;
  testDb = await createTestDb();

  // Nothing here may reach the internet: Google, Resend and PostHog calls
  // fail fast. The Stripe stub listens on loopback.
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return realFetch(input, init);
    return Promise.reject(new TypeError(`network disabled in the authorization matrix: ${url.host}`));
  });

  const member = await createTestUser(testDb.db, { role: USER_ROLES.STANDARD });
  const pro = await createTestUser(testDb.db, { role: USER_ROLES.FOUNDING_MEMBER });
  const founder = await createTestUser(testDb.db, { role: USER_ROLES.FOUNDER });
  const ambassador = await createTestUser(testDb.db, { role: USER_ROLES.AMBASSADOR });

  // An active, already-synced subscription: Pro without a call to Stripe.
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await testDb.db.subscription.create({
    data: {
      currentPeriodEnd: periodEnd,
      currentPeriodStart: now,
      expiresAt: periodEnd,
      isActive: true,
      isCanceled: false,
      isExpired: false,
      isLifetime: false,
      isPaused: false,
      isPending: false,
      isTrial: false,
      standingSyncedAt: now,
      status: "active",
      stripeCustomerId: "cus_matrix_pro",
      stripeSyncedAt: now,
      subscriptionId: "sub_matrix_pro",
      userId: pro.id,
    },
  });

  const ip = (n: number) => new Headers({ "cf-connecting-ip": `203.0.113.${n}` });
  callers.anonymous = createDbCaller(appRouter, testDb.db, { headers: ip(10) });
  callers.member = createDbCaller(appRouter, testDb.db, { headers: ip(11), user: member });
  callers.pro = createDbCaller(appRouter, testDb.db, { headers: ip(12), user: pro });
  callers.founder = createDbCaller(appRouter, testDb.db, { headers: ip(13), user: founder });
  callers.ambassador = createDbCaller(appRouter, testDb.db, { headers: ip(14), user: ambassador });

  expect(await hasProAccess(testDb.db, pro.id)).toBe(true);
  expect(await hasProAccess(testDb.db, member.id)).toBe(false);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  stripeRef.stub = null;
  await stub.close();
  await testDb.close();
});

describe("authorization matrix", () => {
  it("has exactly one row per procedure in the app router", () => {
    const missing = procedurePaths.filter((p) => !(p in POLICY));
    const stale = Object.keys(POLICY).filter((p) => !procedurePaths.includes(p));
    expect({ missing, stale }).toEqual({ missing: [], stale: [] });
  });

  it.each(procedurePaths)("%s", async (procedurePath) => {
    const row = POLICY[procedurePath];
    if (!row) throw new Error(`No POLICY row for ${procedurePath}: add one (see the top of this file).`);

    let resolverDenied = false;
    for (const kind of CALLERS) {
      const expected = EXPECTED[row.access][kind];
      const observed = await call(callers[kind], procedurePath, row.input);
      const label = `${procedurePath} as ${kind}`;

      expect(observed.outcome, `${label}: input failed validation (${observed.message})`).not.toBe("INVALID_INPUT");

      if (expected !== "reaches") {
        expect({ label, outcome: observed.outcome }).toEqual({ label, outcome: expected });
        expect(isGateError(observed), `${label}: denied, but not by the gate: ${observed.message}`).toBe(true);
        continue;
      }

      expect(isGateError(observed), `${label}: stopped by a gate: ${observed.message}`).toBe(false);
      if (observed.outcome === "reaches") continue;
      if (!row.resolverDenies) {
        throw new Error(
          `${label}: the resolver answered ${observed.outcome} (${observed.message}). ` +
            "Pick an input that avoids it or document it in `resolverDenies`.",
        );
      }
      resolverDenied = true;
    }

    if (row.resolverDenies) {
      expect(resolverDenied, `${procedurePath}: \`resolverDenies\` is stale, nothing was denied`).toBe(true);
    }
  });
});
