/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */

import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { cloudinaryClient } from "~/_lib";
import { auth } from "~/auth";
import { entitlementsFor } from "~/server/_billing/entitlements";
import { loadSubscriptionForAccess } from "~/server/_billing/lazySync";
import { getStripe } from "~/server/_billing/stripe";
import { verifyMobileToken } from "~/server/_utils/auth/mobileToken";
import { getClientIp } from "~/server/_utils/clientIp";
import { enforceRateLimit, type RateLimitPolicy } from "~/server/_utils/rateLimit";
import { ADMIN_ROLES } from "~/server/_utils/roles";
import type { UserRole } from "~/server/_utils/roles";
import { db } from "~/server/db";

import { reasonOf } from "./reasonedError";


/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  let session = await auth();

  // Fall back to mobile Bearer JWT when there is no NextAuth session
  if (!session) {
    const authHeader = opts.headers.get("authorization");
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    // Null for anything but a valid, unexpired token issued by this app for
    // the mobile audience (see mobileToken.ts).
    const mobile = bearer ? await verifyMobileToken(bearer) : null;
    if (mobile) {
      const user = await db.user.findUnique({
        where: { id: mobile.userId },
        select: { id: true, email: true, firstName: true, lastName: true },
      });
      if (user) {
        session = {
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            name: `${user.firstName} ${user.lastName}`,
          },
          expires: mobile.expiresAt.toISOString(),
        };
      }
    }
  }

  return {
    cloudinaryClient,
    db,
    session,
    ...opts,
  };
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        // Machine-readable reason, when the error has one (see ErrorReason).
        reason: reasonOf(error),
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
  transformer: superjson,
});

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 */
export const publicProcedure = t.procedure;

/** Reusable middleware that enforces users are logged in before running the procedure. */
const enforceUserIsAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      // infers the `session` as non-nullable
      session: { ...ctx.session, user: ctx.session.user },
    },
  });
});

/**
 * Rate-limits a procedure: `.use(rateLimit(RateLimits.MESSAGE_SEND))`.
 *
 * Signed-in callers are counted per user, anonymous callers per IP address.
 * On protectedProcedure the auth check has already run, so unauthenticated
 * requests are rejected before they are counted.
 */
export const rateLimit = (policy: RateLimitPolicy) =>
  t.middleware(async ({ ctx, next }) => {
    const userId = ctx.session?.user?.id;
    const identifier = userId
      ? `user:${userId}`
      : `ip:${getClientIp(ctx.headers)}`;
    await enforceRateLimit(ctx.db, policy, identifier);
    return next();
  });

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = t.procedure.use(enforceUserIsAuthed);

/** Reusable middleware that enforces the user has an active Pro subscription. */
const enforceUserHasProSubscription = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  // The stored row; one that was never read from Stripe syncs itself
  // first (bounded, and never an error: see _billing/lazySync.ts).
  const subscription = await loadSubscriptionForAccess(ctx.db, getStripe, ctx.session.user.id);

  // Access is derived from the stored Stripe state in one place.
  if (!entitlementsFor(subscription, new Date()).hasProAccess) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "An active Pro subscription is required to access this feature.",
    });
  }

  return next({
    ctx: {
      session: { ...ctx.session, user: ctx.session.user },
      subscription,
    },
  });
});

/**
 * Pro (authenticated + subscribed) procedure
 *
 * Use this for queries or mutations that require an active Pro subscription.
 * It chains authentication check + subscription check.
 * Throws UNAUTHORIZED if not logged in, FORBIDDEN if no active subscription.
 *
 * @see https://trpc.io/docs/procedures
 */
export const proProcedure = t.procedure
  .use(enforceUserIsAuthed)
  .use(enforceUserHasProSubscription);

/** Reusable middleware that enforces the user has a founder or ambassador role. */
const enforceUserIsFounder = t.middleware(async ({ ctx, next }) => {
  // Defense-in-depth: session is guaranteed by enforceUserIsAuthed in the
  // founderProcedure chain, but we check here too so this middleware is safe
  // to use standalone.
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  const user = await ctx.db.user.findUnique({
    where: { id: ctx.session.user.id },
    select: { role: true },
  });

  if (
    !user ||
    typeof user.role !== "string" ||
    !ADMIN_ROLES.includes(user.role as UserRole)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Founder or ambassador access is required.",
    });
  }

  return next({
    ctx: {
      session: { ...ctx.session, user: ctx.session.user },
    },
  });
});

/**
 * Founder (authenticated + founder/ambassador role) procedure
 *
 * Use this for admin-level queries or mutations that only founders/ambassadors can access.
 * Throws UNAUTHORIZED if not logged in, FORBIDDEN if not a founder/ambassador.
 */
export const founderProcedure = t.procedure
  .use(enforceUserIsAuthed)
  .use(enforceUserIsFounder);
