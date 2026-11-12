import type { AnyTRPCRouter } from "@trpc/server";
import { vi } from "vitest";

import type { TestDb } from "./sqlite";

type CallerOptions = {
  cloudinaryClient?: unknown;
  headers?: Headers;
  /** Signs the caller in as this user. Omit for an anonymous caller. */
  user?: { email: string; id: string };
};

/** A Cloudinary client stand-in that "uploads" to the test cloud. */
export function fakeCloudinary(cloudName = "test-cloud") {
  let uploads = 0;
  const upload = vi.fn(async (_image: { base64: string; mime: string }, folder: string) => {
    uploads += 1;
    return {
      isErr: false as const,
      isOk: true as const,
      value: {
        secure_url: `https://res.cloudinary.com/${cloudName}/image/upload/v1/${folder}/${uploads}.jpg`,
      },
    };
  });
  return { upload };
}

/**
 * A tRPC caller whose context holds a real SQLite database (see
 * createTestDb), so procedures run their actual queries.
 */
export function createDbCaller<TRouter extends AnyTRPCRouter>(
  router: TRouter,
  db: TestDb["db"],
  options: CallerOptions = {},
) {
  // The context is built by hand instead of by createTRPCContext, which
  // needs Auth.js and a request.
  const createCaller = router.createCaller as (
    context: unknown,
  ) => ReturnType<TRouter["createCaller"]>;

  return createCaller({
    cloudinaryClient: options.cloudinaryClient ?? fakeCloudinary(),
    db,
    headers: options.headers ?? new Headers({ "cf-connecting-ip": "203.0.113.7" }),
    session: options.user
      ? {
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          user: { ...options.user, name: "Test User" },
        }
      : null,
  });
}
