import { jobToken } from "~/_lib/jobToken";
import { env } from "~/env";
import { isJobName, runJob } from "~/server/_jobs";
import { timingSafeEqualStrings } from "~/server/_utils/hash";
import { db } from "~/server/db";

export const dynamic = "force-dynamic";

function notFound(): Response {
  // The same answer for a wrong token and an unknown job: nothing to probe.
  return new Response("Not found", { headers: { "Cache-Control": "no-store" }, status: 404 });
}

/**
 * Runs one scheduled job (src/server/_jobs). Called by the Worker's
 * `scheduled` handler for each Cron Trigger; not part of the public API.
 *
 * Two locks: the Worker entry refuses this path for requests from outside
 * (worker.ts), and the caller must present a token derived from AUTH_SECRET
 * for exactly this job (~/_lib/jobToken).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ name: string }> },
): Promise<Response> {
  const { name } = await context.params;
  const presented = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!presented || !isJobName(name)) return notFound();

  const expected = await jobToken(env.AUTH_SECRET, name);
  if (!(await timingSafeEqualStrings(presented, expected))) return notFound();

  const outcome = await runJob(name, db);
  return Response.json(outcome, {
    headers: { "Cache-Control": "no-store" },
    status: outcome.ok ? 200 : 500,
  });
}
