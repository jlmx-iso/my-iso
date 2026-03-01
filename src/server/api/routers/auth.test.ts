import { TRPCError } from "@trpc/server";
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
    verificationToken: {
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
    },
  };
  return db;
});

const mockCreateUser = vi.hoisted(() => vi.fn());
const mockCreateVerificationToken = vi.hoisted(() => vi.fn());
const mockVerifyUserEmail = vi.hoisted(() => vi.fn());
const mockSendEmail = vi.hoisted(() => vi.fn());
const mockCaptureEvent = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("~/server/db", () => ({ db: mockDb }));

// Prevent module-level supabase/cloudinary initialization inside trpc.ts context
vi.mock("~/_lib", () => ({ cloudinaryClient: null }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));

vi.mock("~/server/_db", () => ({
  createUser: mockCreateUser,
  createVerificationToken: mockCreateVerificationToken,
  verifyUserEmail: mockVerifyUserEmail,
}));

vi.mock("~/server/_lib/posthog", () => ({
  captureEvent: mockCaptureEvent,
  getPostHogClient: vi.fn(() => null),
}));

vi.mock("~/server/_lib/email", () => ({
  sendEmail: mockSendEmail,
  sendTemplateEmail: vi.fn(),
}));

// auth.ts dynamically imports "../../_lib/emails" for OTP rendering
vi.mock("~/server/_lib/emails", () => ({
  renderMobileOtpEmail: vi.fn(async () => "<html>OTP code</html>"),
}));

vi.mock("~/server/_utils/rateLimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  RateLimits: {
    AUTH: { limit: 10, window: 900 },
    STRICT: { limit: 5, window: 300 },
  },
}));

vi.mock("~/env", () => ({
  env: {
    AUTH_SECRET: "test-secret-that-is-at-least-32-chars-long!!!",
    GOOGLE_CLIENT_ID: "test-google-client-id",
    NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
    NODE_ENV: "test",
    STRIPE_SECRET_KEY: "sk_test_placeholder",
  },
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { authRouter } from "./auth";
import { UserVerificationErrors } from "~/_types/errors";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeOk<T>(value: T) {
  return { isErr: false, isOk: true, value };
}

function makeErr(message: string) {
  return { error: new Error(message), isErr: true, isOk: false };
}

const defaultHeaders = new Headers({
  "x-forwarded-for": "127.0.0.1",
  "x-real-ip": "127.0.0.1",
});

function makeCaller(session: unknown = null) {
  return authRouter.createCaller({
    cloudinaryClient: null,
    db: mockDb,
    headers: defaultHeaders,
    session,
  } as Parameters<typeof authRouter.createCaller>[0]);
}

const validRegisterInput = {
  companyName: "Acme Photo",
  email: "jane@example.com",
  firstName: "Jane",
  lastName: "Doe",
  location: "Los Angeles",
  phone: "5555551234",
  provider: "email" as const,
};

const fakeUser = {
  createdAt: new Date(),
  email: "jane@example.com",
  firstName: "Jane",
  id: "user-1",
  lastName: "Doe",
  role: "standard",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Rate limit: allow by default
  mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9, retryAfter: 0 });
});

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

describe("authRouter.register", () => {
  it("creates user and sends verification email on valid input", async () => {
    mockCreateUser.mockResolvedValueOnce(makeOk(fakeUser));
    mockCreateVerificationToken.mockResolvedValueOnce(makeOk("123456"));
    mockSendEmail.mockResolvedValueOnce(makeOk({ success: true }));

    const caller = makeCaller();
    const result = await caller.register(validRegisterInput);

    expect(result).toBe("User registered successfully!");
    expect(mockCreateUser).toHaveBeenCalledOnce();
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  it("throws INTERNAL_SERVER_ERROR when createUser returns Err", async () => {
    mockCreateUser.mockResolvedValueOnce(makeErr("User already exists"));

    const caller = makeCaller();

    await expect(caller.register(validRegisterInput)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("throws INTERNAL_SERVER_ERROR when createVerificationToken returns Err", async () => {
    mockCreateUser.mockResolvedValueOnce(makeOk(fakeUser));
    mockCreateVerificationToken.mockResolvedValueOnce(makeErr("Token error"));

    const caller = makeCaller();

    await expect(caller.register(validRegisterInput)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("throws BAD_REQUEST when sendEmail returns Err", async () => {
    mockCreateUser.mockResolvedValueOnce(makeOk(fakeUser));
    mockCreateVerificationToken.mockResolvedValueOnce(makeOk("123456"));
    mockSendEmail.mockResolvedValueOnce(makeErr("Email failed"));

    const caller = makeCaller();

    await expect(caller.register(validRegisterInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

// ---------------------------------------------------------------------------
// verifyAccount
// ---------------------------------------------------------------------------

describe("authRouter.verifyAccount", () => {
  it("returns success string on valid token", async () => {
    mockVerifyUserEmail.mockResolvedValueOnce(makeOk("user-1"));

    const caller = makeCaller();
    const result = await caller.verifyAccount({ token: "123456" });

    expect(result).toBe("Email verified successfully!");
  });

  it("throws NOT_FOUND for TOKEN_NOT_FOUND error", async () => {
    mockVerifyUserEmail.mockResolvedValueOnce(
      makeErr(UserVerificationErrors.TOKEN_NOT_FOUND),
    );

    const caller = makeCaller();

    await expect(caller.verifyAccount({ token: "bad" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws BAD_REQUEST for TOKEN_EXPIRED error", async () => {
    mockVerifyUserEmail.mockResolvedValueOnce(
      makeErr(UserVerificationErrors.TOKEN_EXPIRED),
    );

    const caller = makeCaller();

    await expect(caller.verifyAccount({ token: "expired" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("throws BAD_REQUEST for USER_ALREADY_VERIFIED error", async () => {
    mockVerifyUserEmail.mockResolvedValueOnce(
      makeErr(UserVerificationErrors.USER_ALREADY_VERIFIED),
    );

    const caller = makeCaller();

    await expect(caller.verifyAccount({ token: "dup" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("throws NOT_FOUND for USER_NOT_FOUND error", async () => {
    mockVerifyUserEmail.mockResolvedValueOnce(
      makeErr(UserVerificationErrors.USER_NOT_FOUND),
    );

    const caller = makeCaller();

    await expect(caller.verifyAccount({ token: "ghost" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ---------------------------------------------------------------------------
// requestMobileOtp
// ---------------------------------------------------------------------------

describe("authRouter.requestMobileOtp", () => {
  it("silently returns { sent: true } when email not found (no enumeration)", async () => {
    mockDb.user.findUnique.mockResolvedValueOnce(null);

    const caller = makeCaller();
    const result = await caller.requestMobileOtp({ email: "ghost@example.com" });

    expect(result.sent).toBe(true);
    expect(result.devCode).toBeUndefined();
  });

  it("creates token, sends email, and returns { sent: true } in non-dev (test) mode", async () => {
    // NODE_ENV='test' → isDev=false → takes the email path
    mockDb.user.findUnique.mockResolvedValueOnce({ id: "user-1" });
    mockDb.verificationToken.deleteMany.mockResolvedValueOnce({});
    mockDb.verificationToken.create.mockResolvedValueOnce({
      token: "123456",
      identifier: "otp:test@example.com",
      expires: new Date(),
    });
    // sendEmail must succeed so the handler doesn't throw
    mockSendEmail.mockResolvedValueOnce({ isOk: true, isErr: false, value: { success: true } });

    const caller = makeCaller();
    const result = await caller.requestMobileOtp({ email: "test@example.com" });

    expect(result.sent).toBe(true);
    // Non-dev mode: devCode is undefined (not exposed to client)
    expect(result.devCode).toBeUndefined();
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  it("throws TOO_MANY_REQUESTS when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfter: 60,
    });

    const caller = makeCaller();

    await expect(
      caller.requestMobileOtp({ email: "test@example.com" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

// ---------------------------------------------------------------------------
// verifyMobileOtp
// ---------------------------------------------------------------------------

describe("authRouter.verifyMobileOtp", () => {
  const email = "test@example.com";
  const code = "000000";

  it("returns token and userId for valid non-expired code", async () => {
    mockDb.verificationToken.findUnique.mockResolvedValueOnce({
      expires: new Date(Date.now() + 60_000),
      identifier: `otp:${email}`,
      token: code,
    });
    mockDb.verificationToken.delete.mockResolvedValueOnce({});
    mockDb.user.findUnique.mockResolvedValueOnce({
      email,
      id: "user-1",
    });

    const caller = makeCaller();
    const result = await caller.verifyMobileOtp({ code, email });

    expect(result.userId).toBe("user-1");
    expect(typeof result.token).toBe("string");
    expect(result.token.length).toBeGreaterThan(0);
  });

  it("throws UNAUTHORIZED when code not found", async () => {
    mockDb.verificationToken.findUnique.mockResolvedValueOnce(null);

    const caller = makeCaller();

    await expect(caller.verifyMobileOtp({ code, email })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("throws UNAUTHORIZED when code is expired, and deletes record", async () => {
    mockDb.verificationToken.findUnique.mockResolvedValueOnce({
      expires: new Date(Date.now() - 1000),
      identifier: `otp:${email}`,
      token: code,
    });
    mockDb.verificationToken.delete.mockResolvedValueOnce({});

    const caller = makeCaller();

    await expect(caller.verifyMobileOtp({ code, email })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(mockDb.verificationToken.delete).toHaveBeenCalledOnce();
  });

  it("throws TOO_MANY_REQUESTS when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfter: 30,
    });

    const caller = makeCaller();

    await expect(caller.verifyMobileOtp({ code, email })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });
});
