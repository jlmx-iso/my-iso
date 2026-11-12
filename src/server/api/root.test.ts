import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));

import { appRouter } from "./root";

/** Flat "router.procedure" paths of everything the API exposes. */
const procedurePaths = Object.keys(appRouter._def.procedures);

/** Calls `path` with no session and returns the resulting error code. */
async function anonymousErrorCode(procedurePath: string): Promise<string | undefined> {
  const createCaller = appRouter.createCaller as unknown as (
    context: unknown,
  ) => Record<string, Record<string, (input: unknown) => Promise<unknown>>>;
  const caller = createCaller({
    cloudinaryClient: null,
    // Any database access by an unauthenticated call would throw here.
    db: {},
    headers: new Headers(),
    session: null,
  });
  const [router = "", name = ""] = procedurePath.split(".");
  try {
    await caller[router]?.[name]?.(undefined);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

/**
 * Every procedure that may be called without a session. Adding to this list
 * is a security decision: the procedure must be safe for the whole internet
 * to call (rate limited if it writes, sends mail or costs money, and
 * returning nothing private).
 */
const PUBLIC_PROCEDURES = [
  "auth.exchangeMobileToken",
  "auth.requestMobileOtp",
  "auth.verifyMobileOtp",
  "invite.prepareRegistration",
  "invite.validate",
  "photographer.getByUsername",
  "photographer.getPortfolioImages",
  "review.getAverageRating",
  "review.getByPhotographerId",
  // The same public data as getByPhotographerId, as { items, nextCursor }.
  "review.getPageByPhotographerId",
  "waitlist.submit",
];

/**
 * Every procedure that only a Pro member may call. Each must be built on
 * `proProcedure` (checked below: a signed-in member without Pro gets
 * FORBIDDEN before anything else happens), and every procedure that is
 * Pro-only must be listed here.
 */
const PRO_PROCEDURES = ["insights.getSummary", "support.contact"];

/** Calls `path` as a signed-in member with no subscription; returns the error code. */
async function nonProErrorCode(procedurePath: string): Promise<string | undefined> {
  const createCaller = appRouter.createCaller as unknown as (
    context: unknown,
  ) => Record<string, Record<string, (input: unknown) => Promise<unknown>>>;
  const caller = createCaller({
    cloudinaryClient: null,
    // The Pro check reads the member's subscription row (none) and nothing else.
    db: { subscription: { findUnique: async () => null } },
    headers: new Headers(),
    session: { expires: new Date(Date.now() + 60_000).toISOString(), user: { email: "m@example.com", id: "member" } },
  });
  const [router = "", name = ""] = procedurePath.split(".");
  try {
    await caller[router]?.[name]?.(undefined);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("appRouter surface", () => {
  it("has removed the dead, dangerous endpoints", () => {
    const paths = procedurePaths;

    expect(paths).not.toContain("auth.register");
    expect(paths).not.toContain("auth.verifyAccount");
    expect(paths).not.toContain("photographer.search");
    expect(paths.filter((p) => p.startsWith("favorite."))).toEqual([]);
    // Favorites live on the user router, scoped to the session.
    expect(paths).toEqual(expect.arrayContaining(["user.addFavorite", "user.removeFavorite"]));
    // A mutation that changed nothing (matches expire at read time and by a
    // scheduled job), and a name that said "by user id" for "the caller's own".
    expect(paths).not.toContain("discover.expireStaleMatches");
    expect(paths).not.toContain("message.getLatestThreadByUserId");
    expect(paths).toContain("message.getMyLatestThread");
  });

  it("refuses a signed-in member without Pro on every Pro procedure, before reading the input", async () => {
    for (const procedurePath of PRO_PROCEDURES) {
      expect(procedurePaths).toContain(procedurePath);
      expect([procedurePath, await nonProErrorCode(procedurePath)]).toEqual([procedurePath, "FORBIDDEN"]);
    }
  });

  it("lists every procedure that refuses members without Pro", async () => {
    // With a database that holds only "no subscription", the Pro check is
    // the only thing that can answer FORBIDDEN before failing on the stub.
    const refusing: string[] = [];
    for (const procedurePath of procedurePaths) {
      if ((await nonProErrorCode(procedurePath)) === "FORBIDDEN") refusing.push(procedurePath);
    }
    expect(refusing.sort()).toEqual([...PRO_PROCEDURES].sort());
  });

  it("rejects anonymous callers on every procedure outside the public list", async () => {
    const protectedPaths = procedurePaths.filter(
      (procedurePath) => !PUBLIC_PROCEDURES.includes(procedurePath),
    );
    expect(protectedPaths.length).toBeGreaterThan(40);

    for (const procedurePath of protectedPaths) {
      expect([procedurePath, await anonymousErrorCode(procedurePath)]).toEqual([
        procedurePath,
        "UNAUTHORIZED",
      ]);
    }
  });

  it("keeps the public list in step with the router", () => {
    for (const procedurePath of PUBLIC_PROCEDURES) {
      expect(procedurePaths).toContain(procedurePath);
    }
  });
});

describe("session cookie exposure", () => {
  const read = (file: string) =>
    readFileSync(path.resolve(__dirname, "../../..", file), "utf8");

  it("the root layout does not read the request's cookies", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).not.toMatch(/cookies\s*\(/);
    expect(layout).not.toContain("next/headers");
    expect(layout).toContain("<TRPCReactProvider>");
  });

  it("the client tRPC provider takes no cookie prop and sets no cookie header", () => {
    const provider = read("src/trpc/react.tsx");
    expect(provider).toContain('"use client"');
    expect(provider).not.toMatch(/props\.cookies|cookies\s*:/);
    expect(provider).not.toMatch(/\bcookie\s*:/i);
  });
});
