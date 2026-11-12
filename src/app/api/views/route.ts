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
  /** viewSourceToken() from the page; without a matching one the view counts under "other". */
  token: z.string().max(64).optional(),
});

/**
 * Off Cloudflare (next dev, next start, tests) the limiters live in this
 * process: bounded maps that forget each window, never a store that must
 * survive between requests.
 */
const fallbackLimiters = memoryViewLimiters();

type LimiterBindings = { VIEW_ANON_LIMIT?: ViewLimiter; VIEW_COUNT_LIMIT?: ViewLimiter };

let reportedMissingBinding = false;

/**
 * Cloudflare's Rate Limiting bindings (wrangler.toml `ratelimits`); the
 * in-process limiters only off Cloudflare. On Cloudflare without both
 * bindings (a deploy that lost them) nothing is counted: a per-isolate
 * limiter would bound nothing, since every isolate starts afresh. Logged
 * once per isolate.
 */
function viewLimiters(): ViewLimiters | null {
  let bindings: LimiterBindings;
  try {
    bindings = getCloudflareContext().env as LimiterBindings;
  } catch {
    // Not running on Cloudflare.
    return fallbackLimiters;
  }
  if (bindings.VIEW_ANON_LIMIT && bindings.VIEW_COUNT_LIMIT) {
    return { anonymous: bindings.VIEW_ANON_LIMIT, perClient: bindings.VIEW_COUNT_LIMIT };
  }
  if (!reportedMissingBinding) {
    reportedMissingBinding = true;
    logger.error("View counting is off: a Rate Limiting binding is missing", {
      VIEW_ANON_LIMIT: Boolean(bindings.VIEW_ANON_LIMIT),
      VIEW_COUNT_LIMIT: Boolean(bindings.VIEW_COUNT_LIMIT),
    });
  }
  return null;
}

/**
 * The body as text, or null when it is larger than MAX_BODY_BYTES: refused
 * by its declared length before reading, and otherwise read only up to the
 * cap (a body without a length, or one longer than it says, is cut off).
 */
async function readCappedBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
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
 *
 * Views count only when the page is served from the canonical host
 * (NEXT_PUBLIC_BASE_URL's origin): the beacon's Origin must equal it. The
 * apex/www redirect must make that one host canonical, or views on the
 * other are never counted.
 */
export async function POST(request: Request): Promise<Response> {
  // Same-origin only: a page elsewhere cannot spend this site's counts.
  if (request.headers.get("origin") !== new URL(SITE_URL).origin) return new Response(null, { status: 403 });

  const text = await readCappedBody(request);
  if (text === null) return new Response(null, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return new Response(null, { status: 400 });

  const limiters = viewLimiters();
  if (!limiters) return noContent();

  try {
    const session = await auth();
    const result = await countView(db, limiters, {
      clientIp: getClientIp(request.headers),
      cookie: cookieValue(request.headers.get("cookie")),
      source: parsed.data.source,
      sourceToken: parsed.data.token ?? null,
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
