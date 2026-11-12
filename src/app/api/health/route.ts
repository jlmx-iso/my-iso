import { logger } from "~/_utils";
import { env } from "~/env";
import { db } from "~/server/db";

// Always evaluated per request: the point is to check this instance now.
export const dynamic = "force-dynamic";

/**
 * Liveness and readiness in one cheap call: the Worker answers, and the
 * database answers a trivial query. For uptime monitors and for checking a
 * deploy (`curl https://<host>/api/health`).
 *
 * Public and unauthenticated, so it reports only what is safe to publish:
 * the deployment's name, the app version and the commit it was built from.
 * `build.environment` is what the bundle was built for (NEXT_PUBLIC_APP_ENV);
 * if it differs from `environment` (APP_ENV, set per deployment in
 * wrangler.toml), the wrong build was deployed.
 */
export async function GET(): Promise<Response> {
  let database: "ok" | "error" = "ok";
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (error) {
    database = "error";
    logger.error("Health check: database query failed", { error });
  }

  const healthy = database === "ok";
  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      environment: env.APP_ENV ?? "development",
      version: process.env.APP_VERSION ?? "unknown",
      commit: process.env.APP_COMMIT ?? "unknown",
      build: { environment: env.NEXT_PUBLIC_APP_ENV ?? "development" },
      checks: { database },
    },
    { headers: { "Cache-Control": "no-store" }, status: healthy ? 200 : 503 },
  );
}
