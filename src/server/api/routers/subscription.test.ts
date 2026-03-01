import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be before any imports
// ---------------------------------------------------------------------------

const mockDb = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    user: {
      findUnique: vi.fn(),
    },
    subscription: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  };
  return db;
});

const mockStripeCheckoutCreate = vi.hoisted(() => vi.fn());
const mockStripePortalCreate = vi.hoisted(() => vi.fn());
const mockStripeSubscriptionsList = vi.hoisted(() => vi.fn());
const mockCaptureEvent = vi.hoisted(() => vi.fn());

vi.mock("~/server/db", () => ({ db: mockDb }));

// Prevent module-level supabase/cloudinary initialization inside trpc.ts context
vi.mock("~/_lib", () => ({ cloudinaryClient: null }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));

vi.mock("stripe", () => {
  // Must use a regular function (not arrow) so it's usable as a constructor
  function MockStripe() {
    return {
      checkout: { sessions: { create: mockStripeCheckoutCreate } },
      billingPortal: { sessions: { create: mockStripePortalCreate } },
      subscriptions: { list: mockStripeSubscriptionsList },
    };
  }
  return { default: MockStripe };
});

vi.mock("~/server/_lib/posthog", () => ({
  captureEvent: mockCaptureEvent,
  getPostHogClient: vi.fn(() => null),
}));

vi.mock("~/env", () => ({
  env: {
    AUTH_SECRET: "test-secret-that-is-at-least-32-chars-long!!!",
    NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
    NODE_ENV: "test",
    STRIPE_FOUNDING_ANNUAL_PRICE_ID: undefined,
    STRIPE_FOUNDING_MONTHLY_PRICE_ID: undefined,
    STRIPE_SECRET_KEY: "sk_test_placeholder",
    STRIPE_STANDARD_ANNUAL_PRICE_ID: undefined,
    STRIPE_STANDARD_MONTHLY_PRICE_ID: undefined,
  },
}));

vi.mock("~/_utils", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("~/server/_utils/pricing", () => ({
  getPriceIdForCheckout: vi.fn(() => null),
  getPricingForRole: vi.fn((role: string) => {
    if (["founding_member", "founder", "ambassador"].includes(role)) {
      return {
        annualPrice: 99,
        isFoundingPrice: true,
        monthlyPrice: 10,
        standardMonthlyPrice: 19,
      };
    }
    return {
      annualPrice: 179,
      isFoundingPrice: false,
      monthlyPrice: 19,
      standardMonthlyPrice: 19,
    };
  }),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { subscriptionRouter } from "./subscription";
import { getPriceIdForCheckout, getPricingForRole } from "~/server/_utils/pricing";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const authedSession = {
  expires: new Date(Date.now() + 86_400_000).toISOString(),
  user: { email: "test@example.com", id: "user-1", name: "Test User" },
};

function makeAuthedCaller() {
  return subscriptionRouter.createCaller({
    cloudinaryClient: null,
    db: mockDb,
    headers: new Headers(),
    session: authedSession,
  } as Parameters<typeof subscriptionRouter.createCaller>[0]);
}

function makeAnonCaller() {
  return subscriptionRouter.createCaller({
    cloudinaryClient: null,
    db: mockDb,
    headers: new Headers(),
    session: null,
  } as Parameters<typeof subscriptionRouter.createCaller>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPricingForRole).mockReturnValue({
    annualPrice: 179,
    isFoundingPrice: false,
    monthlyPrice: 19,
    standardMonthlyPrice: 19,
  });
  vi.mocked(getPriceIdForCheckout).mockReturnValue(null);
});

// ---------------------------------------------------------------------------
// getPricing
// ---------------------------------------------------------------------------

describe("subscriptionRouter.getPricing", () => {
  it("throws UNAUTHORIZED when not logged in", async () => {
    const caller = makeAnonCaller();

    await expect(caller.getPricing()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns standard pricing for standard user", async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ role: "standard" });

    const caller = makeAuthedCaller();
    const result = await caller.getPricing();

    expect(result.isFoundingPrice).toBe(false);
    expect(result.monthlyPrice).toBe(19);
  });

  it("returns founding pricing for founding_member role", async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ role: "founding_member" });
    vi.mocked(getPricingForRole).mockReturnValueOnce({
      annualPrice: 99,
      isFoundingPrice: true,
      monthlyPrice: 10,
      standardMonthlyPrice: 19,
    });

    const caller = makeAuthedCaller();
    const result = await caller.getPricing();

    expect(result.isFoundingPrice).toBe(true);
    expect(result.monthlyPrice).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------

describe("subscriptionRouter.getStatus", () => {
  it("throws UNAUTHORIZED when not logged in", async () => {
    const caller = makeAnonCaller();

    await expect(caller.getStatus()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns subscription when one exists", async () => {
    const fakeSub = {
      userId: "user-1",
      isActive: true,
      isCanceled: false,
      isPaused: false,
      isTrial: false,
      isExpired: false,
      isPending: false,
      isLifetime: false,
      subscriptionId: "sub_123",
      expiresAt: null,
    };
    mockDb.subscription.findUnique.mockResolvedValueOnce(fakeSub);

    const caller = makeAuthedCaller();
    const result = await caller.getStatus();

    expect(result).toEqual(fakeSub);
  });

  it("returns null when no subscription exists", async () => {
    mockDb.subscription.findUnique.mockResolvedValueOnce(null);

    const caller = makeAuthedCaller();
    const result = await caller.getStatus();

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createCheckoutSession
// ---------------------------------------------------------------------------

describe("subscriptionRouter.createCheckoutSession", () => {
  it("throws UNAUTHORIZED when not logged in", async () => {
    const caller = makeAnonCaller();

    await expect(
      caller.createCheckoutSession({ billingInterval: "monthly" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("uses inline price_data when no Stripe Price ID is configured", async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ role: "standard", stripeId: null });
    vi.mocked(getPriceIdForCheckout).mockReturnValueOnce(null);
    const fakeSession = { id: "cs_test_123", url: "https://checkout.stripe.com/pay/cs_test_123" };
    mockStripeCheckoutCreate.mockResolvedValueOnce(fakeSession);

    const caller = makeAuthedCaller();
    const result = await caller.createCheckoutSession({ billingInterval: "monthly" });

    expect(result.url).toBe(fakeSession.url);
    expect(mockStripeCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: expect.arrayContaining([
          expect.objectContaining({ price_data: expect.any(Object) }),
        ]),
      }),
    );
    expect(mockCaptureEvent).toHaveBeenCalledWith(
      "user-1",
      "upgrade_initiated",
      expect.any(Object),
    );
  });

  it("uses Stripe Price ID when env var is set", async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ role: "standard", stripeId: null });
    vi.mocked(getPriceIdForCheckout).mockReturnValueOnce("price_standard_monthly");
    const fakeSession = { id: "cs_test_456", url: "https://checkout.stripe.com/pay/cs_test_456" };
    mockStripeCheckoutCreate.mockResolvedValueOnce(fakeSession);

    const caller = makeAuthedCaller();
    await caller.createCheckoutSession({ billingInterval: "monthly" });

    expect(mockStripeCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: "price_standard_monthly", quantity: 1 }],
      }),
    );
  });

  it("uses existing stripeId as customer when present", async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({
      role: "standard",
      stripeId: "cus_existing_123",
    });
    const fakeSession = { id: "cs_test_789", url: "https://checkout.stripe.com/pay/cs_test_789" };
    mockStripeCheckoutCreate.mockResolvedValueOnce(fakeSession);

    const caller = makeAuthedCaller();
    await caller.createCheckoutSession({ billingInterval: "monthly" });

    expect(mockStripeCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_existing_123",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// createPortalSession
// ---------------------------------------------------------------------------

describe("subscriptionRouter.createPortalSession", () => {
  it("throws UNAUTHORIZED when not logged in", async () => {
    const caller = makeAnonCaller();

    await expect(caller.createPortalSession()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("throws when no stripeId is found", async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ stripeId: null });

    const caller = makeAuthedCaller();

    await expect(caller.createPortalSession()).rejects.toThrow(
      /No Stripe customer found/,
    );
  });

  it("returns portal URL for user with stripeId", async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ stripeId: "cus_portal_123" });
    mockStripePortalCreate.mockResolvedValueOnce({
      id: "bps_test_123",
      url: "https://billing.stripe.com/portal/test",
    });

    const caller = makeAuthedCaller();
    const result = await caller.createPortalSession();

    expect(result.url).toBe("https://billing.stripe.com/portal/test");
    expect(mockStripePortalCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_portal_123" }),
    );
  });
});
