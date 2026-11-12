import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";

import { SITE_URL } from "~/_lib/site";
import { logger } from "~/_utils";
import { VIEW_SOURCES } from "~/_utils/viewSources";
import { auth } from "~/auth";
import {
  countView,
  memoryViewLimiters,
  secondsToEndOfDay,
  VIEW_COOKIE,
  type ViewLimiter,
  type ViewLimiters,
} from "~/server/_lib/viewCounter";
import { getClientIp } from "~/server/_utils/clientIp";
import { db } from "~/server/db";

const MAX_BODY_BYTES = 512;

const bodySchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(["profile", "event"]),
  source: z.enum(VIEW_SOURCES),
});

/**
 * Off Cloudflare (next dev, next start, tests) the limiters live in this
 * process: bounded maps that forget each window, never a store that must
 * survive between requests.
 */
const fallbackLimiters = memoryViewLimiters();

type LimiterBindings = { VIEW_ANON_LIMIT?: ViewLimiter; VIEW_COUNT_LIMIT?: ViewLimiter };

/** Cloudflare's Rate Limiting bindings (wrangler.toml `ratelimits`), else the in-process ones. */
function viewLimiters(): ViewLimiters {
  let bindings: LimiterBindings = {};
  try {
    bindings = getCloudflareContext().env as LimiterBindings;
  } catch {
    // Not running on Cloudflare.
  }
  return {
    anonymous: bindings.VIEW_ANON_LIMIT ?? fallbackLimiters.anonymous,
    perClient: bindings.VIEW_COUNT_LIMIT ?? fallbackLimiters.perClient,
  };
}

function noContent(cookie?: string | null): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (cookie) {
    const secure = SITE_URL.startsWith("https:") ? "; Secure" : "";
    headers.append(
      "Set-Cookie",
      `${VIEW_COOKIE}=${cookie}; Path=/api/views; Max-Age=${secondsToEndOfDay(new Date())}; HttpOnly; SameSite=Lax${secure}`,
    );
  }
  return new Response(null, { headers, status: 204 });
}

function cookieValue(header: string | null): string | null {
  for (const part of (header ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === VIEW_COOKIE) return rest.join("=");
  }
  return null;
}

/**
 * Counts a view of a profile or event page for the owner's Pro insights.
 * The page calls it once it is on screen (ViewBeacon). It always answers
 * 204 and says nothing about the outcome: whether a view was counted is
 * nobody's business but the counter's. The rules are in
 * src/server/_lib/viewCounter.ts.
 */
export async function POST(request: Request): Promise<Response> {
  // Same-origin only: a page elsewhere cannot spend this site's counts.
  if (request.headers.get("origin") !== new URL(SITE_URL).origin) return new Response(null, { status: 403 });

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return new Response(null, { status: 400 });

  try {
    const session = await auth();
    const result = await countView(db, viewLimiters(), {
      clientIp: getClientIp(request.headers),
      cookie: cookieValue(request.headers.get("cookie")),
      source: parsed.data.source,
      target: { id: parsed.data.id, kind: parsed.data.kind },
      userAgent: request.headers.get("user-agent"),
      viewerId: session?.user?.id ?? null,
    });
    return noContent(result.cookie);
  } catch (error) {
    // A lost view is not worth an error page or a retry storm.
    logger.warn("Could not count a view", { error });
    return noContent();
  }
}
