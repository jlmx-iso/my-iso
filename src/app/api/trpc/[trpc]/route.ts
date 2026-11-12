import type { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { type NextRequest } from "next/server";

import { logger } from "~/_utils";
import { env } from "~/env";
import { captureServerException } from "~/server/_lib/posthog";
import { guardTrpcRequest, MAX_TRPC_BATCH_SIZE } from "~/server/api/requestGuards";
import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";

const ENDPOINT = "/api/trpc";

/** Errors that say the request was wrong, not that the server is. */
const EXPECTED_ERROR_CODES = new Set<TRPCError["code"]>([
  "BAD_REQUEST",
  "CONFLICT",
  "FORBIDDEN",
  "NOT_FOUND",
  "PARSE_ERROR",
  "PAYLOAD_TOO_LARGE",
  "PRECONDITION_FAILED",
  "TOO_MANY_REQUESTS",
  "UNAUTHORIZED",
  "UNPROCESSABLE_CONTENT",
]);

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a HTTP request (e.g. when you make requests from Client Components).
 */
const createContext = async (req: NextRequest) => {
  return createTRPCContext({
    headers: req.headers,
  });
};

const handler = (req: NextRequest) => {
  const rejection = guardTrpcRequest(req, ENDPOINT);
  if (rejection) return rejection;

  return fetchRequestHandler({
    createContext: () => createContext(req),
    endpoint: ENDPOINT,
    maxBatchSize: MAX_TRPC_BATCH_SIZE,
    onError: ({ ctx, error, path }) => {
      if (EXPECTED_ERROR_CODES.has(error.code)) {
        // The caller's mistake (validation, auth, rate limits): worth a line
        // while developing, noise in production.
        if (env.NODE_ENV === "development") {
          logger.warn("tRPC rejected a request", { code: error.code, path });
        }
        return;
      }

      // A server fault, in every environment: log it and report it. Only the
      // procedure name, the error code and the user id go along; never the
      // input, cookies or the authorization header.
      logger.error("tRPC failed on path", { error, path });
      captureServerException(error.cause ?? error, {
        distinctId: ctx?.session?.user?.id,
        extra: { code: error.code, procedure: path },
        path: `${ENDPOINT}/${path ?? ""}`,
        source: "trpc",
      });
    },
    req,
    router: appRouter,
  });
};

export { handler as GET, handler as POST };
