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
  // The mock context only implements the parts of the real context that the
  // routers under test touch, so it is deliberately not checked against it.
  const createCaller = router.createCaller as (
    context: unknown,
  ) => ReturnType<TRouter["createCaller"]>;
  return createCaller(buildContext(ctx));
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
