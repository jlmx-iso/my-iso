import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must run before any module is imported
// ---------------------------------------------------------------------------

const mockDb = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    user: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    verificationToken: {
      delete: vi.fn(),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  db.$transaction.mockImplementation((cb: (tx: typeof db) => unknown) => cb(db));
  return db;
});

vi.mock("~/server/db", () => ({ db: mockDb }));

vi.mock("~/_utils", () => ({
  Result: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ok: (v: any) => ({ isOk: true, isErr: false, value: v }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    err: (e: any) => ({ isOk: false, isErr: true, error: e }),
  },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Actual imports (resolved after mocks are hoisted)
// ---------------------------------------------------------------------------

import { createUser, verifyUserEmail } from "./user";
import { UserVerificationErrors } from "~/_types/errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseInput = {
  companyName: "Acme Photo",
  email: "test@example.com",
  facebook: undefined,
  firstName: "Jane",
  instagram: undefined,
  lastName: "Doe",
  location: "Los Angeles",
  phone: "+15555551234",
  provider: "email" as const,
  tiktok: undefined,
  twitter: undefined,
  vimeo: undefined,
  website: undefined,
  youtube: undefined,
};

const fakeUser = {
  id: "user-1",
  email: "test@example.com",
  emailVerified: null,
  firstName: "Jane",
  lastName: "Doe",
  phone: "+15555551234",
  role: "standard",
  stripeId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  // Restore $transaction default
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  (mockDb.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    (cb: (tx: typeof mockDb) => unknown) => cb(mockDb),
  );
});

// ---------------------------------------------------------------------------
// createUser
// ---------------------------------------------------------------------------

describe("createUser", () => {
  it("creates user and returns Result.ok when email is unique", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mockDb.user.findFirst.mockResolvedValueOnce(null);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mockDb.user.create.mockResolvedValueOnce(fakeUser);

    const result = await createUser(baseInput);

    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value).toEqual(fakeUser);
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(mockDb.user.create).toHaveBeenCalledOnce();
  });

  it("returns Result.err('User already exists') when email is taken", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mockDb.user.findFirst.mockResolvedValueOnce({ id: "existing-user" });

    const result = await createUser(baseInput);

    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.message).toBe("User already exists");
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(mockDb.user.create).not.toHaveBeenCalled();
  });

  it("returns Result.err when findFirst throws", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mockDb.user.findFirst.mockRejectedValueOnce(new Error("DB error"));

    const result = await createUser(baseInput);

    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.message).toBe("Error finding user");
    }
  });

  it("returns Result.err('Error registering user') when create throws", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mockDb.user.findFirst.mockResolvedValueOnce(null);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mockDb.user.create.mockRejectedValueOnce(new Error("Constraint violation"));

    const result = await createUser(baseInput);

    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.message).toBe("Error registering user");
    }
  });
});

// ---------------------------------------------------------------------------
// verifyUserEmail
// ---------------------------------------------------------------------------

const fakeToken = {
  expires: new Date(Date.now() + 60_000), // not expired
  identifier: "user-1",
  token: "123456",
};

describe("verifyUserEmail", () => {
  it("returns Result.ok(userId) for valid non-expired token", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mockDb.verificationToken.findFirst.mockResolvedValueOnce(fakeToken);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mockDb.user.findFirst.mockResolvedValueOnce({ ...fakeUser, emailVerified: null });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mockDb.user.update.mockResolvedValueOnce({ ...fakeUser, emailVerified: new Date() });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mockDb.verificationToken.delete.mockResolvedValueOnce(fakeToken);

    const result = await verifyUserEmail("123456");

    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value).toBe("user-1");
    }
  });

  it("returns Result.err(TOKEN_NOT_FOUND) when token is absent", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mockDb.verificationToken.findFirst.mockResolvedValueOnce(null);

    const result = await verifyUserEmail("bad-token");

    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.message).toBe(UserVerificationErrors.TOKEN_NOT_FOUND);
    }
  });

  it("returns Result.err(TOKEN_EXPIRED) for expired token", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mockDb.verificationToken.findFirst.mockResolvedValueOnce({
      ...fakeToken,
      expires: new Date(Date.now() - 1000), // expired
    });

    const result = await verifyUserEmail("123456");

    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.message).toBe(UserVerificationErrors.TOKEN_EXPIRED);
    }
  });

  it("returns Result.err(USER_NOT_FOUND) when user doesn't exist", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mockDb.verificationToken.findFirst.mockResolvedValueOnce(fakeToken);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mockDb.user.findFirst.mockResolvedValueOnce(null);

    const result = await verifyUserEmail("123456");

    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.message).toBe(UserVerificationErrors.USER_NOT_FOUND);
    }
  });

  it("returns Result.err(USER_ALREADY_VERIFIED) when user is already verified", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mockDb.verificationToken.findFirst.mockResolvedValueOnce(fakeToken);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mockDb.user.findFirst.mockResolvedValueOnce({
      ...fakeUser,
      emailVerified: new Date(), // already verified
    });

    const result = await verifyUserEmail("123456");

    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.message).toBe(UserVerificationErrors.USER_ALREADY_VERIFIED);
    }
  });

  it("returns Result.err when transaction throws", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mockDb.verificationToken.findFirst.mockResolvedValueOnce(fakeToken);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mockDb.user.findFirst.mockResolvedValueOnce({ ...fakeUser, emailVerified: null });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    (mockDb.$transaction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Transaction failed"),
    );

    const result = await verifyUserEmail("123456");

    expect(result.isErr).toBe(true);
  });
});
