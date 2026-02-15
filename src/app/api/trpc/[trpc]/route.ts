import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { type NextRequest } from "next/server";

import { logger } from "~/_utils";
import { env } from "~/env";
import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a HTTP request (e.g. when you make requests from Client Components).
 */
const createContext = async (req: NextRequest) => {
  return createTRPCContext({
    headers: req.headers,
  });
};

const handler = (req: NextRequest) =>
  fetchRequestHandler({
    createContext: () => createContext(req),
    endpoint: "/api/trpc",
    onError:
      env.NODE_ENV === "development"
        ? ({ path, error }) => {
          logger.error(
            "❌ tRPC failed on path",
            { error, path }
          );
        }
        : undefined,
    req,
    router: appRouter,
  });

export { handler as GET, handler as POST };

/**
 * Runtime configuration:
 * - Local development: Node.js runtime (better-sqlite3 requires fs)
 * - Production on Cloudflare: Edge runtime (D1 adapter, no fs needed)
 *
 * Switch to 'edge' when deploying to Cloudflare Workers/Pages.
 */
export const runtime = 'nodejs';
