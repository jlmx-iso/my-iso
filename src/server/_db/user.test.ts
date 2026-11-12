import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must run before any module is imported
// ---------------------------------------------------------------------------

const mockDb = vi.hoisted(() => {
  const db = {
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
   
  db.$transaction.mockImplementation((cb: (tx: typeof db) => unknown) => cb(db));
  return db;
});

vi.mock("~/server/db", () => ({ db: mockDb }));

vi.mock("~/_utils", () => ({
  Result: {
    ok: (v: unknown) => ({ isOk: true, isErr: false, value: v }),
    err: (e: unknown) => ({ isOk: false, isErr: true, error: e }),
  },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Actual imports (resolved after mocks are hoisted)
// ---------------------------------------------------------------------------

import { UserVerificationErrors } from "~/_types/errors";

import { createUser, verifyUserEmail } from "./user";

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
   
  (mockDb.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    (cb: (tx: typeof mockDb) => unknown) => cb(mockDb),
  );
});

// ---------------------------------------------------------------------------
// createUser
// ---------------------------------------------------------------------------

describe("createUser", () => {
  it("creates user and returns Result.ok when email is unique", async () => {
     
    mockDb.user.findFirst.mockResolvedValueOnce(null);
     
    mockDb.user.create.mockResolvedValueOnce(fakeUser);

    const result = await createUser(baseInput);

    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value).toEqual(fakeUser);
    }
     
    expect(mockDb.user.create).toHaveBeenCalledOnce();
  });

  it("returns Result.err('User already exists') when email is taken", async () => {
     
    mockDb.user.findFirst.mockResolvedValueOnce({ id: "existing-user" });

    const result = await createUser(baseInput);

    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.message).toBe("User already exists");
    }
     
    expect(mockDb.user.create).not.toHaveBeenCalled();
  });

  it("returns Result.err when findFirst throws", async () => {
     
    mockDb.user.findFirst.mockRejectedValueOnce(new Error("DB error"));

    const result = await createUser(baseInput);

    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.message).toBe("Error finding user");
    }
  });

  it("returns Result.err('Error registering user') when create throws", async () => {
     
    mockDb.user.findFirst.mockResolvedValueOnce(null);
     
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
     
    mockDb.verificationToken.findFirst.mockResolvedValueOnce(fakeToken);
     
    mockDb.user.findFirst.mockResolvedValueOnce({ ...fakeUser, emailVerified: null });
     
    mockDb.user.update.mockResolvedValueOnce({ ...fakeUser, emailVerified: new Date() });
     
    mockDb.verificationToken.delete.mockResolvedValueOnce(fakeToken);

    const result = await verifyUserEmail("123456");

    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value).toBe("user-1");
    }
  });

  it("returns Result.err(TOKEN_NOT_FOUND) when token is absent", async () => {
     
    mockDb.verificationToken.findFirst.mockResolvedValueOnce(null);

    const result = await verifyUserEmail("bad-token");

    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.message).toBe(UserVerificationErrors.TOKEN_NOT_FOUND);
    }
  });

  it("returns Result.err(TOKEN_EXPIRED) for expired token", async () => {
     
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
     
    mockDb.verificationToken.findFirst.mockResolvedValueOnce(fakeToken);
     
    mockDb.user.findFirst.mockResolvedValueOnce(null);

    const result = await verifyUserEmail("123456");

    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.message).toBe(UserVerificationErrors.USER_NOT_FOUND);
    }
  });

  it("returns Result.err(USER_ALREADY_VERIFIED) when user is already verified", async () => {
     
    mockDb.verificationToken.findFirst.mockResolvedValueOnce(fakeToken);
     
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
     
    mockDb.verificationToken.findFirst.mockResolvedValueOnce(fakeToken);
     
    mockDb.user.findFirst.mockResolvedValueOnce({ ...fakeUser, emailVerified: null });
     
    (mockDb.$transaction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Transaction failed"),
    );

    const result = await verifyUserEmail("123456");

    expect(result.isErr).toBe(true);
  });
});
