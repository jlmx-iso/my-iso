import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";

import { minimalInput } from "~/test/helpers/zodSample";

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

/** The input schemas of a procedure (tRPC merges them), for minimalInput. */
function inputSchemas(procedurePath: string): ZodType[] {
  const procedure = (appRouter._def.procedures as unknown as Record<string, { _def: { inputs?: unknown[] } }>)[procedurePath];
  return (procedure?._def.inputs ?? []) as ZodType[];
}

/**
 * Calls `path` as a signed-in member with no subscription, with `input`;
 * returns the error code.
 */
async function nonProErrorCode(procedurePath: string, input?: unknown): Promise<string | undefined> {
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
    await caller[router]?.[name]?.(input);
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

  it("lists every procedure that refuses members without Pro, called with valid input", async () => {
    // Each procedure is called with the smallest input its schema accepts,
    // so a Pro check written inside a resolver (after input validation) is
    // reached too. The database holds only "no subscription": a Pro check
    // (proProcedure, hasProAccess, loadSubscriptionForAccess) answers
    // FORBIDDEN; anything else fails on the stub. Nothing may leave the
    // process meanwhile.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in this test"));
    try {
      const refusing: string[] = [];
      let withInput = 0;
      for (const procedurePath of procedurePaths) {
        const schemas = inputSchemas(procedurePath);
        const input = minimalInput(schemas);
        if (schemas.length > 0 && input !== undefined) withInput += 1;
        if ((await nonProErrorCode(procedurePath, input)) === "FORBIDDEN") refusing.push(procedurePath);
      }
      expect(refusing.sort()).toEqual([...PRO_PROCEDURES].sort());
      // Most procedures were reached past their input validation.
      expect(withInput).toBeGreaterThan(procedurePaths.length / 2);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("finds a hand-rolled Pro check inside a resolver, which undefined input would not reach", async () => {
    const { createTRPCRouter, protectedProcedure } = await import("./trpc");
    const { hasProAccess } = await import("~/server/_billing/entitlements");
    const { TRPCError } = await import("@trpc/server");
    const { z } = await import("zod");
    const sneaky = createTRPCRouter({
      export: protectedProcedure.input(z.object({ days: z.number().int().min(7) })).query(async ({ ctx, input }) => {
        if (!(await hasProAccess(ctx.db, ctx.session.user.id))) throw new TRPCError({ code: "FORBIDDEN" });
        return input.days;
      }),
    });
    const caller = (sneaky.createCaller as unknown as (context: unknown) => { export: (input: unknown) => Promise<unknown> })({
      cloudinaryClient: null,
      db: { subscription: { findUnique: async () => null } },
      headers: new Headers(),
      session: { expires: new Date(Date.now() + 60_000).toISOString(), user: { email: "m@example.com", id: "member" } },
    });
    const schemas = (sneaky._def.procedures as unknown as Record<string, { _def: { inputs: ZodType[] } }>).export?._def.inputs ?? [];
    await expect(caller.export(undefined)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.export(minimalInput(schemas))).rejects.toMatchObject({ code: "FORBIDDEN" });
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
