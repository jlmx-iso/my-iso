import type { AnyTRPCRouter } from "@trpc/server";
import { mockDb } from "../mocks/db";

type MockSession = {
  user: { id: string; email: string; name?: string };
  expires: string;
} | null;

type MockContext = {
  db?: typeof mockDb;
  session?: MockSession;
  headers?: Headers;
  cloudinaryClient?: null;
};

/** Build a base context compatible with createTRPCContext output. */
function buildContext(overrides: MockContext = {}) {
  return {
    cloudinaryClient: null,
    db: mockDb,
    headers: new Headers(),
    session: null,
    ...overrides,
  };
}

/** Create a tRPC caller with no session (public procedures only). */
export function createTestCaller<TRouter extends AnyTRPCRouter>(
  router: TRouter,
  ctx: MockContext = {},
) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
  return (router as any).createCaller(buildContext(ctx)) as ReturnType<
    TRouter["createCaller"]
  >;
}

/** Create a tRPC caller with an authenticated session. */
export function createAuthedCaller<TRouter extends AnyTRPCRouter>(
  router: TRouter,
  overrides: MockContext = {},
) {
  return createTestCaller(router, {
    session: {
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      user: { email: "test@example.com", id: "user-1", name: "Test User" },
    },
    ...overrides,
  });
}
