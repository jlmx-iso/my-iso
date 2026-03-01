import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockDb = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    user: {
      findUnique: vi.fn(),
    },
    waitlist: {
      count: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    pendingInviteValidation: {
      upsert: vi.fn(),
    },
    subscription: {
      findUnique: vi.fn(),
    },
  };
  return db;
});

const mockCaptureEvent = vi.hoisted(() => vi.fn());
const mockSendTemplateEmail = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("~/server/db", () => ({ db: mockDb }));

// Prevent module-level supabase/cloudinary initialization inside trpc.ts context
vi.mock("~/_lib", () => ({ cloudinaryClient: null }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));

vi.mock("~/server/_lib/posthog", () => ({
  captureEvent: mockCaptureEvent,
  getPostHogClient: vi.fn(() => null),
}));

vi.mock("~/server/_lib/email", () => ({
  sendEmail: vi.fn(),
  sendTemplateEmail: mockSendTemplateEmail,
}));

vi.mock("~/server/_utils/rateLimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  RateLimits: {
    STRICT: { limit: 5, window: 300 },
  },
}));

vi.mock("~/env", () => ({
  env: {
    NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
    NODE_ENV: "test",
    STRIPE_SECRET_KEY: "sk_test_placeholder",
  },
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { waitlistRouter } from "./waitlist";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultHeaders = new Headers({ "x-forwarded-for": "127.0.0.1" });

const founderSession = {
  expires: new Date(Date.now() + 86_400_000).toISOString(),
  user: { email: "founder@example.com", id: "founder-1", name: "Founder" },
};

function makePublicCaller() {
  return waitlistRouter.createCaller({
    cloudinaryClient: null,
    db: mockDb,
    headers: defaultHeaders,
    session: null,
  } as Parameters<typeof waitlistRouter.createCaller>[0]);
}

function makeFounderCaller() {
  // founderProcedure checks ctx.db.user.findUnique for role
  return waitlistRouter.createCaller({
    cloudinaryClient: null,
    db: mockDb,
    headers: defaultHeaders,
    session: founderSession,
  } as Parameters<typeof waitlistRouter.createCaller>[0]);
}

function makeOk<T>(value: T) {
  return { isErr: false, isOk: true, value };
}

const baseSubmitInput = {
  email: "photographer@example.com",
  name: "Jane Smith",
  userType: "both" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Allow rate limit by default
  mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4, retryAfter: 0 });
  // Email succeeds by default
  mockSendTemplateEmail.mockResolvedValue(makeOk({ success: true }));
  // Founder role check: return founder role for founder caller
  mockDb.user.findUnique.mockResolvedValue({ role: "founder" });
});

// ---------------------------------------------------------------------------
// submit
// ---------------------------------------------------------------------------

describe("waitlistRouter.submit", () => {
  it("creates entry and returns { success: true, position }", async () => {
    mockDb.waitlist.findUnique.mockResolvedValueOnce(null);
    mockDb.waitlist.findFirst.mockResolvedValueOnce({ position: 5 });
    mockDb.waitlist.create.mockResolvedValueOnce({ id: "wl-1", position: 6 });

    const caller = makePublicCaller();
    const result = await caller.submit(baseSubmitInput);

    expect(result.success).toBe(true);
    expect(result.position).toBe(6);
    expect(mockDb.waitlist.create).toHaveBeenCalledOnce();
    expect(mockCaptureEvent).toHaveBeenCalledOnce();
  });

  it("assigns position = maxPosition + 1", async () => {
    mockDb.waitlist.findUnique.mockResolvedValueOnce(null);
    mockDb.waitlist.findFirst.mockResolvedValueOnce({ position: 42 });
    mockDb.waitlist.create.mockResolvedValueOnce({ id: "wl-1", position: 43 });

    const caller = makePublicCaller();
    const result = await caller.submit(baseSubmitInput);

    expect(result.position).toBe(43);
    // Verify create was called with position 43
    expect(mockDb.waitlist.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ position: 43 }),
      }),
    );
  });

  it("assigns position 1 when waitlist is empty", async () => {
    mockDb.waitlist.findUnique.mockResolvedValueOnce(null);
    mockDb.waitlist.findFirst.mockResolvedValueOnce(null); // no existing entries
    mockDb.waitlist.create.mockResolvedValueOnce({ id: "wl-1", position: 1 });

    const caller = makePublicCaller();
    const result = await caller.submit(baseSubmitInput);

    expect(result.position).toBe(1);
  });

  it("throws CONFLICT on duplicate email", async () => {
    mockDb.waitlist.findUnique.mockResolvedValueOnce({
      id: "existing-wl",
      email: "photographer@example.com",
    });

    const caller = makePublicCaller();

    await expect(caller.submit(baseSubmitInput)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(mockDb.waitlist.create).not.toHaveBeenCalled();
  });

  it("throws TOO_MANY_REQUESTS when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfter: 60,
    });

    const caller = makePublicCaller();

    await expect(caller.submit(baseSubmitInput)).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });

  it("does NOT throw when email fails (fire-and-forget)", async () => {
    mockDb.waitlist.findUnique.mockResolvedValueOnce(null);
    mockDb.waitlist.findFirst.mockResolvedValueOnce({ position: 0 });
    mockDb.waitlist.create.mockResolvedValueOnce({ id: "wl-1", position: 1 });
    mockSendTemplateEmail.mockResolvedValueOnce({
      error: new Error("email failed"),
      isErr: true,
      isOk: false,
    });

    const caller = makePublicCaller();

    // Should not throw even when email fails
    await expect(caller.submit(baseSubmitInput)).resolves.toMatchObject({
      success: true,
    });
  });
});

// ---------------------------------------------------------------------------
// getAll (founderProcedure)
// ---------------------------------------------------------------------------

describe("waitlistRouter.getAll", () => {
  const fakeItems = [
    {
      id: "wl-1",
      name: "Jane",
      email: "jane@example.com",
      status: "pending",
      position: 1,
      createdAt: new Date(),
      reviewedBy: null,
    },
  ];

  it("throws UNAUTHORIZED when unauthenticated", async () => {
    const caller = makePublicCaller();

    await expect(
      caller.getAll({ limit: 20, page: 1, status: "pending" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("throws FORBIDDEN when user is not a founder", async () => {
    // Override the role check to return non-founder
    mockDb.user.findUnique.mockResolvedValueOnce({ role: "standard" });

    const caller = makeFounderCaller();

    await expect(
      caller.getAll({ limit: 20, page: 1, status: "pending" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns paginated items and total for founder", async () => {
    mockDb.waitlist.findMany.mockResolvedValueOnce(fakeItems);
    mockDb.waitlist.count.mockResolvedValueOnce(1);

    const caller = makeFounderCaller();
    const result = await caller.getAll({ limit: 20, page: 1, status: "pending" });

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.page).toBe(1);
  });

  it("passes no where filter for status='all'", async () => {
    mockDb.waitlist.findMany.mockResolvedValueOnce(fakeItems);
    mockDb.waitlist.count.mockResolvedValueOnce(1);

    const caller = makeFounderCaller();
    await caller.getAll({ limit: 20, page: 1, status: "all" });

    expect(mockDb.waitlist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it("passes status filter for status='pending'", async () => {
    mockDb.waitlist.findMany.mockResolvedValueOnce(fakeItems);
    mockDb.waitlist.count.mockResolvedValueOnce(1);

    const caller = makeFounderCaller();
    await caller.getAll({ limit: 20, page: 1, status: "pending" });

    expect(mockDb.waitlist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "pending" } }),
    );
  });
});

// ---------------------------------------------------------------------------
// approve (founderProcedure)
// ---------------------------------------------------------------------------

describe("waitlistRouter.approve", () => {
  it("throws NOT_FOUND for non-existent entry", async () => {
    mockDb.waitlist.findUnique.mockResolvedValueOnce(null);

    const caller = makeFounderCaller();

    await expect(caller.approve({ id: "nonexistent" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws BAD_REQUEST if entry is already reviewed", async () => {
    mockDb.waitlist.findUnique.mockResolvedValueOnce({
      id: "wl-1",
      email: "user@example.com",
      name: "User",
      status: "approved", // already reviewed
    });

    const caller = makeFounderCaller();

    await expect(caller.approve({ id: "wl-1" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("upserts PendingInviteValidation and updates status for pending entry", async () => {
    mockDb.waitlist.findUnique.mockResolvedValueOnce({
      email: "user@example.com",
      id: "wl-1",
      name: "User",
      status: "pending",
    });
    mockDb.pendingInviteValidation.upsert.mockResolvedValueOnce({});
    mockDb.waitlist.update.mockResolvedValueOnce({});

    const caller = makeFounderCaller();
    const result = await caller.approve({ id: "wl-1" });

    expect(result.success).toBe(true);
    expect(mockDb.pendingInviteValidation.upsert).toHaveBeenCalledOnce();
    expect(mockDb.waitlist.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "approved" }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// reject (founderProcedure)
// ---------------------------------------------------------------------------

describe("waitlistRouter.reject", () => {
  it("throws NOT_FOUND for non-existent entry", async () => {
    mockDb.waitlist.findUnique.mockResolvedValueOnce(null);

    const caller = makeFounderCaller();

    await expect(caller.reject({ id: "nonexistent" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws BAD_REQUEST if entry is already reviewed", async () => {
    mockDb.waitlist.findUnique.mockResolvedValueOnce({
      id: "wl-1",
      email: "user@example.com",
      name: "User",
      status: "rejected", // already reviewed
    });

    const caller = makeFounderCaller();

    await expect(caller.reject({ id: "wl-1" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("updates status to rejected for pending entry", async () => {
    mockDb.waitlist.findUnique.mockResolvedValueOnce({
      email: "user@example.com",
      id: "wl-1",
      name: "User",
      status: "pending",
    });
    mockDb.waitlist.update.mockResolvedValueOnce({});

    const caller = makeFounderCaller();
    const result = await caller.reject({ id: "wl-1" });

    expect(result.success).toBe(true);
    expect(mockDb.waitlist.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "rejected" }),
      }),
    );
  });
});
