import { describe, expect, it, vi } from "vitest";

import { TELEMETRY_PROXY_PATH } from "../telemetryConfig.js";
import {
  buildUpstreamHeaders,
  handleTelemetryProxy,
  isTelemetryProxyPath,
  mapTelemetryUrl,
  MAX_EVENT_BODY_BYTES,
  MAX_REPLAY_BODY_BYTES,
} from "./telemetryProxy";

const ORIGIN = "https://myiso.app";
const hosts = {
  apiHost: "https://us.i.posthog.com",
  assetsHost: "https://us-assets.i.posthog.com",
};

type FetchCall = { init: RequestInit; url: string };

/** A fetch stand-in that records what the proxy sent upstream. */
function upstream(response: () => Response = () => new Response("ok")) {
  const calls: FetchCall[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ init, url });
    return response();
  });
  return { calls, fetch };
}

function proxy(
  request: Request,
  fetch: ReturnType<typeof upstream>["fetch"],
  clientIp = "203.0.113.9",
) {
  return handleTelemetryProxy(request, { ...hosts, clientIp, fetch });
}

const post = (path: string, init: RequestInit = {}) =>
  new Request(`${ORIGIN}${path}`, { body: "payload", method: "POST", ...init });

const sentHeaders = (call: FetchCall | undefined) => new Headers(call?.init.headers);

describe("the proxy path", () => {
  it("avoids every word content blockers match on", () => {
    expect(TELEMETRY_PROXY_PATH).toMatch(/^\/[a-z]+$/);
    expect(TELEMETRY_PROXY_PATH).not.toMatch(
      /ingest|posthog|analytics|tracking|telemetry|collect|ph$|event|stats|metric/i,
    );
  });

  it("matches the prefix and what is under it, nothing that merely starts like it", () => {
    expect(isTelemetryProxyPath("/lens")).toBe(true);
    expect(isTelemetryProxyPath("/lens/e/")).toBe(true);
    expect(isTelemetryProxyPath("/lenses")).toBe(false);
    expect(isTelemetryProxyPath("/app/lens")).toBe(false);
    expect(isTelemetryProxyPath("/")).toBe(false);
  });
});

describe("mapTelemetryUrl: only what the browser SDK requests", () => {
  const map = (path: string) => mapTelemetryUrl(new URL(path, ORIGIN), hosts)?.target.toString();

  it("sends event capture and replay to the ingestion host, keeping the query", () => {
    expect(map("/lens/e/?ip=0&_=1&ver=1.2.3")).toBe("https://us.i.posthog.com/e/?ip=0&_=1&ver=1.2.3");
    expect(map("/lens/e")).toBe("https://us.i.posthog.com/e");
    expect(map("/lens/i/v0/e/?compression=gzip-js")).toBe(
      "https://us.i.posthog.com/i/v0/e/?compression=gzip-js",
    );
    expect(map("/lens/batch/")).toBe("https://us.i.posthog.com/batch/");
    expect(map("/lens/s/?compression=gzip")).toBe("https://us.i.posthog.com/s/?compression=gzip");
  });

  it("sends SDK bundles and remote config to the assets host", () => {
    expect(map("/lens/static/recorder.js?v=1.2.3")).toBe(
      "https://us-assets.i.posthog.com/static/recorder.js?v=1.2.3",
    );
    expect(map("/lens/static/1.447.12/exception-autocapture.js")).toBe(
      "https://us-assets.i.posthog.com/static/1.447.12/exception-autocapture.js",
    );
    expect(map("/lens/array/phc_abc/config.js")).toBe(
      "https://us-assets.i.posthog.com/array/phc_abc/config.js",
    );
    expect(map("/lens/array/phc_abc/config")).toBe(
      "https://us-assets.i.posthog.com/array/phc_abc/config",
    );
  });

  it.each([
    // PostHog's private API, reachable with a personal key if it were proxied.
    "/lens/api/projects/1/persons/",
    "/lens/api/surveys/?token=phc_abc",
    "/lens/api/environments/1/query/",
    // Flags: the browser evaluates none.
    "/lens/flags/?v=2",
    "/lens/decide/?v=3",
    // Other ingestion products the app does not use.
    "/lens/i/v1/logs",
    "/lens/i/v1/metrics",
    "/lens/engage/",
    // The root and anything unknown.
    "/lens",
    "/lens/",
    "/lens/anything",
    // Look-alikes of allowed routes.
    "/lens/e/extra",
    "/lens/e/static/",
    "/lens/staticfile",
    "/lens/static/",
    "/lens/static/a/b/c.js",
    "/lens/static/recorder.js.map",
    "/lens/static/..%2f..%2fapi%2fusers.js",
    "/lens/array/phc_abc/other.js",
    "/lens/array/phc_abc/config.js/x",
    "/lens/s/x",
  ])("refuses %s", (path) => {
    expect(mapTelemetryUrl(new URL(path, ORIGIN), hosts)).toBeNull();
  });

  it("cannot be steered to another host or out of the prefix", () => {
    expect(mapTelemetryUrl(new URL("/lens//evil.example/e/", ORIGIN), hosts)).toBeNull();
    expect(mapTelemetryUrl(new URL("/lens/%2F%2Fevil.example/", ORIGIN), hosts)).toBeNull();
    // The URL parser resolves dot segments before the prefix is checked.
    expect(mapTelemetryUrl(new URL("/lens/../api/trpc", ORIGIN), hosts)).toBeNull();
    expect(mapTelemetryUrl(new URL("/lens/static/../../api/x.js", ORIGIN), hosts)).toBeNull();
    expect(mapTelemetryUrl(new URL("/api/trpc", ORIGIN), hosts)).toBeNull();
  });

  it("follows the configured region", () => {
    const eu = { apiHost: "https://eu.i.posthog.com", assetsHost: "https://eu-assets.i.posthog.com" };
    expect(mapTelemetryUrl(new URL("/lens/e/", ORIGIN), eu)?.target.host).toBe("eu.i.posthog.com");
    expect(mapTelemetryUrl(new URL("/lens/static/a.js", ORIGIN), eu)?.target.host).toBe(
      "eu-assets.i.posthog.com",
    );
  });
});

describe("buildUpstreamHeaders", () => {
  const request = (headers: Record<string, string>) =>
    new Request(`${ORIGIN}/lens/e/`, { headers, method: "POST" });

  it("strips cookies, every credential and proxy headers", () => {
    const headers = buildUpstreamHeaders(
      request({
        Authorization: "Bearer eyJhbGciOi.session.jwt",
        "CF-Connecting-IP": "203.0.113.9",
        "CF-Ray": "abc",
        "Content-Type": "text/plain",
        Cookie: "authjs.session-token=secret; iso_consent=granted",
        Forwarded: "for=10.0.0.1",
        Host: "myiso.app",
        "Proxy-Authorization": "Basic abc",
        "X-CSRF-Token": "t",
        "X-Forwarded-For": "10.0.0.1, 10.0.0.2",
        "X-Forwarded-Host": "myiso.app",
        "X-Real-IP": "10.0.0.1",
      }),
      "203.0.113.9",
    );

    for (const name of [
      "authorization",
      "cf-connecting-ip",
      "cf-ray",
      "cookie",
      "forwarded",
      "host",
      "proxy-authorization",
      "x-csrf-token",
      "x-forwarded-host",
      "x-real-ip",
    ]) {
      expect(headers.has(name), name).toBe(false);
    }
    expect(headers.get("content-type")).toBe("text/plain");
  });

  it("never forwards Authorization, PostHog keys included", () => {
    for (const value of ["Bearer phx_personal_key", "Bearer phc_project", "Bearer phs_secret", "Basic x"]) {
      expect(buildUpstreamHeaders(request({ Authorization: value }), null).has("authorization")).toBe(
        false,
      );
    }
  });

  it("passes the visitor's address the way PostHog reads it, never a client-sent one", () => {
    const headers = buildUpstreamHeaders(request({ "X-Forwarded-For": "1.2.3.4" }), "203.0.113.9");
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.9");

    const unknown = buildUpstreamHeaders(request({ "X-Forwarded-For": "1.2.3.4" }), null);
    expect(unknown.has("x-forwarded-for")).toBe(false);
  });

  it("keeps what PostHog needs to attribute the event", () => {
    const headers = buildUpstreamHeaders(
      request({ "Accept-Language": "en-GB", Origin: ORIGIN, Referer: `${ORIGIN}/app`, "User-Agent": "UA/1" }),
      null,
    );
    expect(headers.get("user-agent")).toBe("UA/1");
    expect(headers.get("origin")).toBe(ORIGIN);
    expect(headers.get("accept-language")).toBe("en-GB");
  });
});

describe("handleTelemetryProxy", () => {
  it("forwards method, body and query, and returns the upstream response", async () => {
    const { calls, fetch } = upstream(
      () => new Response('{"status":1}', { headers: { "Content-Type": "application/json" } }),
    );
    const response = await proxy(
      post("/lens/e/?compression=gzip-js&ip=0", {
        headers: { "Content-Type": "text/plain", Cookie: "session=secret" },
      }),
      fetch,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"status":1}');
    expect(response.headers.get("content-type")).toBe("application/json");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://us.i.posthog.com/e/?compression=gzip-js&ip=0");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.redirect).toBe("manual");
    expect(await new Response(calls[0]?.init.body).text()).toBe("payload");
    expect(sentHeaders(calls[0]).has("cookie")).toBe(false);
    expect(sentHeaders(calls[0]).get("x-forwarded-for")).toBe("203.0.113.9");
  });

  it("streams the request body instead of buffering it", async () => {
    const { calls, fetch } = upstream();
    await proxy(post("/lens/s/"), fetch);
    expect(calls[0]?.init.body).toBeInstanceOf(ReadableStream);
  });

  it("sends no body with GET", async () => {
    const { calls, fetch } = upstream();
    await proxy(new Request(`${ORIGIN}/lens/static/array.js`), fetch);
    expect(calls[0]?.url).toBe("https://us-assets.i.posthog.com/static/array.js");
    expect(calls[0]?.init.body).toBeNull();
  });

  it("answers 404 for anything that is not an allowed route, without contacting PostHog", async () => {
    const { fetch } = upstream();
    for (const request of [
      new Request(`${ORIGIN}/lens/api/projects/1/persons/`, {
        headers: { Authorization: "Bearer phx_personal_key" },
      }),
      post("/lens/flags/?v=2"),
      new Request(`${ORIGIN}/api/trpc`),
    ]) {
      expect((await proxy(request, fetch)).status).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows each route only the methods the SDK uses on it", async () => {
    const { fetch } = upstream();
    const cases: Array<[string, string, string]> = [
      ["GET", "/lens/e/", "POST"],
      ["PUT", "/lens/e/", "POST"],
      ["DELETE", "/lens/s/", "POST"],
      ["POST", "/lens/static/array.js", "GET, HEAD"],
      ["POST", "/lens/array/phc_abc/config.js", "GET, HEAD"],
      ["OPTIONS", "/lens/e/", "POST"],
    ];
    for (const [method, path, allow] of cases) {
      const response = await proxy(new Request(`${ORIGIN}${path}`, { method }), fetch);
      expect(response.status, `${method} ${path}`).toBe(405);
      expect(response.headers.get("allow")).toBe(allow);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  describe("a visitor who refused analytics", () => {
    const refusals: Array<[string, Record<string, string>]> = [
      ["Sec-GPC: 1", { "Sec-GPC": "1" }],
      ["the consent cookie", { Cookie: "a=1; iso_consent=denied" }],
      ["GPC over a granted cookie", { Cookie: "iso_consent=granted", "Sec-GPC": "1" }],
    ];

    it.each(refusals)("gets 204 and PostHog is not contacted: %s", async (_name, headers) => {
      const { fetch } = upstream();
      for (const request of [
        post("/lens/e/", { headers }),
        post("/lens/s/", { headers }),
        new Request(`${ORIGIN}/lens/array/phc_abc/config.js`, { headers }),
        new Request(`${ORIGIN}/lens/static/recorder.js`, { headers }),
      ]) {
        const response = await proxy(request, fetch);
        expect(response.status).toBe(204);
        expect(await response.text()).toBe("");
      }
      expect(fetch).not.toHaveBeenCalled();
    });

    it("is not confused by other values", async () => {
      const { fetch } = upstream();
      await proxy(post("/lens/e/", { headers: { Cookie: "iso_consent=granted", "Sec-GPC": "0" } }), fetch);
      await proxy(post("/lens/e/"), fetch);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("body size", () => {
    const sized = (path: string, length: number) =>
      post(path, { headers: { "Content-Length": String(length) } });

    it("caps event batches at 1 MiB and replay at 4 MiB", async () => {
      expect(MAX_EVENT_BODY_BYTES).toBe(1024 * 1024);
      expect(MAX_REPLAY_BODY_BYTES).toBe(4 * 1024 * 1024);

      const { fetch } = upstream();
      expect((await proxy(sized("/lens/e/", MAX_EVENT_BODY_BYTES), fetch)).status).toBe(200);
      expect((await proxy(sized("/lens/e/", MAX_EVENT_BODY_BYTES + 1), fetch)).status).toBe(413);
      expect((await proxy(sized("/lens/i/v0/e/", MAX_EVENT_BODY_BYTES + 1), fetch)).status).toBe(413);
      // Replay may be larger than an event batch, up to its own cap.
      expect((await proxy(sized("/lens/s/", MAX_EVENT_BODY_BYTES + 1), fetch)).status).toBe(200);
      expect((await proxy(sized("/lens/s/", MAX_REPLAY_BODY_BYTES + 1), fetch)).status).toBe(413);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("rejects a nonsensical Content-Length", async () => {
      const { fetch } = upstream();
      const response = await proxy(post("/lens/e/", { headers: { "Content-Length": "abc" } }), fetch);
      expect(response.status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("cuts off an undeclared (chunked) body that grows past the cap", async () => {
      const chunk = new Uint8Array(256 * 1024);
      let sent = 0;
      const endless = new ReadableStream<Uint8Array>({
        pull(controller) {
          sent += 1;
          controller.enqueue(chunk);
        },
      });
      const request = new Request(`${ORIGIN}/lens/e/`, {
        body: endless,
        duplex: "half",
        method: "POST",
      } as RequestInit);
      expect(request.headers.has("content-length")).toBe(false);

      const { calls, fetch } = upstream();
      await proxy(request, fetch);

      // The upstream reader sees an error once the cap is passed, long
      // before the source would have ended (it never does).
      await expect(new Response(calls[0]?.init.body).arrayBuffer()).rejects.toThrow(/too large/);
      expect(sent).toBeLessThan(20);
    });
  });

  it("drops Set-Cookie and stale encoding headers from the response", async () => {
    const { fetch } = upstream(
      () =>
        new Response("body", {
          headers: {
            "Cache-Control": "public, max-age=300",
            "Content-Encoding": "gzip",
            "Content-Length": "999",
            "Set-Cookie": "ph=1; Domain=myiso.app",
          },
        }),
    );
    const response = await proxy(new Request(`${ORIGIN}/lens/static/array.js`), fetch);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(response.headers.has("content-encoding")).toBe(false);
    expect(response.headers.get("content-length")).not.toBe("999");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it.each([301, 302, 303, 307, 308])("does not pass on an upstream %i redirect", async (status) => {
    const { fetch } = upstream(
      () => new Response(null, { headers: { Location: "https://evil.example/" }, status }),
    );
    const response = await proxy(post("/lens/e/"), fetch);
    expect(response.status).toBe(502);
    expect(response.headers.has("location")).toBe(false);
  });

  it("still lets a cached SDK file revalidate (304)", async () => {
    const { fetch } = upstream(() => new Response(null, { status: 304 }));
    const response = await proxy(new Request(`${ORIGIN}/lens/static/array.js`), fetch);
    expect(response.status).toBe(304);
  });

  it("passes upstream errors through and answers 502 when PostHog is unreachable", async () => {
    const failing = upstream(() => new Response("nope", { status: 503 }));
    expect((await proxy(post("/lens/e/"), failing.fetch)).status).toBe(503);

    const unreachable = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const response = await handleTelemetryProxy(post("/lens/e/"), {
      ...hosts,
      clientIp: null,
      fetch: unreachable,
    });
    expect(response.status).toBe(502);
  });
});
