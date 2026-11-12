import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { type NextRequest } from "next/server";

import { logger } from "~/_utils";
import { env } from "~/env";
import { guardTrpcRequest, MAX_TRPC_BATCH_SIZE } from "~/server/api/requestGuards";
import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";

const ENDPOINT = "/api/trpc";

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
    onError: ({ path, error }) => {
      // Client mistakes (validation, auth, rate limits) are expected; only
      // server faults are worth a log line in production.
      if (env.NODE_ENV === "development" || error.code === "INTERNAL_SERVER_ERROR") {
        logger.error("tRPC failed on path", { error, path });
      }
    },
    req,
    router: appRouter,
  });
};

export { handler as GET, handler as POST };
