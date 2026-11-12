import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockDb = vi.hoisted(() => {
  const db = {
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
    // The rate limiter's single statement: resolves to the request count.
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
  };
  return db;
});

const mockCaptureEvent = vi.hoisted(() => vi.fn());
const mockSendTemplateEmail = vi.hoisted(() => vi.fn());

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

vi.mock("~/env", () => ({
  env: {
    AUTH_SECRET: "test-secret-that-is-at-least-32-chars-long!!!",
    NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
    NODE_ENV: "test",
    STRIPE_SECRET_KEY: "stripe_test_key_placeholder",
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
  } as unknown as Parameters<typeof waitlistRouter.createCaller>[0]);
}

function makeFounderCaller() {
  // founderProcedure checks ctx.db.user.findUnique for role
  return waitlistRouter.createCaller({
    cloudinaryClient: null,
    db: mockDb,
    headers: defaultHeaders,
    session: founderSession,
  } as unknown as Parameters<typeof waitlistRouter.createCaller>[0]);
}

function makeOk<T>(value: T) {
  return { isErr: false, isOk: true, value };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Allow rate limit by default
  mockDb.$queryRaw.mockResolvedValue([{ count: 1 }]);
  // Email succeeds by default
  mockSendTemplateEmail.mockResolvedValue(makeOk({ success: true }));
  // Founder role check: return founder role for founder caller
  mockDb.user.findUnique.mockResolvedValue({ role: "founder" });
});

// submit is tested against a real database in waitlist.submit.test.ts.

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
    // The join link points at the configured base URL.
    expect(mockSendTemplateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({
          joinUrl: "http://localhost:3000/join?waitlist=approved&email=user%40example.com",
        }),
      }),
    );
    expect(mockDb.pendingInviteValidation.upsert).toHaveBeenCalledOnce();
    expect(mockDb.waitlist.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "approved" }),
      }),
    );
    // The event is the reviewer's: nothing about the applicant (not even a
    // hash of their address) is sent.
    expect(mockCaptureEvent).toHaveBeenCalledWith(expect.any(String), "waitlist_approved", {});
    expect(JSON.stringify(mockCaptureEvent.mock.calls)).not.toContain("user@example.com");
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
