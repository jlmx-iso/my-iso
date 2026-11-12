import { describe, expect, it, vi } from "vitest";

import { TELEMETRY_PROXY_PATH } from "../telemetryConfig.js";
import {
  buildUpstreamHeaders,
  handleTelemetryProxy,
  isTelemetryProxyPath,
  mapTelemetryUrl,
  MAX_TELEMETRY_BODY_BYTES,
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

function proxy(request: Request, fetch: ReturnType<typeof upstream>["fetch"], clientIp = "203.0.113.9") {
  return handleTelemetryProxy(request, { ...hosts, clientIp, fetch });
}

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

describe("mapTelemetryUrl", () => {
  const map = (path: string) => mapTelemetryUrl(new URL(path, ORIGIN), hosts)?.target.toString();

  it("sends capture, flags and replay to the ingestion host, keeping the query", () => {
    expect(map("/lens/e/?ip=0&_=1&ver=1.2.3")).toBe("https://us.i.posthog.com/e/?ip=0&_=1&ver=1.2.3");
    expect(map("/lens/flags/?v=2&config=true")).toBe("https://us.i.posthog.com/flags/?v=2&config=true");
    expect(map("/lens/s/?compression=gzip")).toBe("https://us.i.posthog.com/s/?compression=gzip");
    expect(map("/lens/i/v0/e/")).toBe("https://us.i.posthog.com/i/v0/e/");
    expect(map("/lens")).toBe("https://us.i.posthog.com/");
  });

  it("sends SDK bundles and remote config to the assets host", () => {
    expect(map("/lens/static/recorder.js?v=1.2.3")).toBe(
      "https://us-assets.i.posthog.com/static/recorder.js?v=1.2.3",
    );
    expect(map("/lens/array/phc_abc/config.js")).toBe(
      "https://us-assets.i.posthog.com/array/phc_abc/config.js",
    );
    expect(mapTelemetryUrl(new URL("/lens/static/x.js", ORIGIN), hosts)?.isAsset).toBe(true);
    expect(mapTelemetryUrl(new URL("/lens/e/", ORIGIN), hosts)?.isAsset).toBe(false);
  });

  it("only treats /static/ and /array/ at the start of the path as assets", () => {
    expect(map("/lens/e/static/")).toBe("https://us.i.posthog.com/e/static/");
    expect(map("/lens/staticfile")).toBe("https://us.i.posthog.com/staticfile");
  });

  it("cannot be steered to another host or out of the prefix", () => {
    expect(map("/lens//evil.example/e/")).toBe("https://us.i.posthog.com/evil.example/e/");
    expect(map("/lens/%2F%2Fevil.example/")).toBe("https://us.i.posthog.com/%2F%2Fevil.example/");
    // The URL parser resolves dot segments before the prefix is checked.
    expect(mapTelemetryUrl(new URL("/lens/../api/trpc", ORIGIN), hosts)).toBeNull();
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

  it("strips cookies, this app's credentials and proxy headers", () => {
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

  it("passes the visitor's address the way PostHog reads it, never a client-sent one", () => {
    const headers = buildUpstreamHeaders(request({ "X-Forwarded-For": "1.2.3.4" }), "203.0.113.9");
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.9");

    const unknown = buildUpstreamHeaders(request({ "X-Forwarded-For": "1.2.3.4" }), null);
    expect(unknown.has("x-forwarded-for")).toBe(false);
  });

  it("keeps a PostHog token in Authorization and nothing else", () => {
    const keep = buildUpstreamHeaders(request({ Authorization: "Bearer phc_AbC123_x-y" }), null);
    expect(keep.get("authorization")).toBe("Bearer phc_AbC123_x-y");

    for (const value of ["Bearer sk_live_123", "Basic cGhjXzEyMw==", "Bearer phc_ab c", "phc_abc"]) {
      expect(buildUpstreamHeaders(request({ Authorization: value }), null).has("authorization")).toBe(
        false,
      );
    }
  });

  it("keeps what PostHog needs to attribute the event", () => {
    const headers = buildUpstreamHeaders(
      request({ "Accept-Language": "en-GB", Origin: ORIGIN, Referer: `${ORIGIN}/app`, "User-Agent": "UA/1" }),
      null,
    );
    expect(headers.get("user-agent")).toBe("UA/1");
    expect(headers.get("origin")).toBe(ORIGIN);
    expect(headers.get("referer")).toBe(`${ORIGIN}/app`);
    expect(headers.get("accept-language")).toBe("en-GB");
  });
});

describe("handleTelemetryProxy", () => {
  it("forwards method, body and query, and returns the upstream response", async () => {
    const { calls, fetch } = upstream(
      () => new Response('{"status":1}', { headers: { "Content-Type": "application/json" } }),
    );
    const response = await proxy(
      new Request(`${ORIGIN}/lens/e/?compression=gzip-js&ip=0`, {
        body: "payload",
        headers: { "Content-Type": "text/plain", Cookie: "session=secret" },
        method: "POST",
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
    await proxy(new Request(`${ORIGIN}/lens/s/`, { body: "replay", method: "POST" }), fetch);
    expect(calls[0]?.init.body).toBeInstanceOf(ReadableStream);
  });

  it("sends no body with GET", async () => {
    const { calls, fetch } = upstream();
    await proxy(new Request(`${ORIGIN}/lens/static/array.js`), fetch);
    expect(calls[0]?.url).toBe("https://us-assets.i.posthog.com/static/array.js");
    expect(calls[0]?.init.body).toBeNull();
  });

  it.each(["PUT", "PATCH", "DELETE", "OPTIONS"])("refuses %s", async (method) => {
    const { fetch } = upstream();
    const response = await proxy(new Request(`${ORIGIN}/lens/e/`, { method }), fetch);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD, POST");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a declared body over the cap without contacting PostHog", async () => {
    const { fetch } = upstream();
    const response = await proxy(
      new Request(`${ORIGIN}/lens/s/`, {
        body: "x",
        headers: { "Content-Length": String(MAX_TELEMETRY_BODY_BYTES + 1) },
        method: "POST",
      }),
      fetch,
    );
    expect(response.status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts a body at the cap", async () => {
    const { fetch } = upstream();
    const response = await proxy(
      new Request(`${ORIGIN}/lens/s/`, {
        body: "x",
        headers: { "Content-Length": String(MAX_TELEMETRY_BODY_BYTES) },
        method: "POST",
      }),
      fetch,
    );
    expect(response.status).toBe(200);
  });

  it("rejects a nonsensical Content-Length", async () => {
    const { fetch } = upstream();
    const response = await proxy(
      new Request(`${ORIGIN}/lens/e/`, {
        body: "x",
        headers: { "Content-Length": "abc" },
        method: "POST",
      }),
      fetch,
    );
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cuts off an undeclared (chunked) body that grows past the cap", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const request = new Request(`${ORIGIN}/lens/s/`, {
      body: endless,
      duplex: "half",
      method: "POST",
    } as RequestInit);
    expect(request.headers.has("content-length")).toBe(false);

    const { calls, fetch } = upstream();
    await proxy(request, fetch);

    // The upstream reader sees an error once the cap is passed, long before
    // the source would have ended (it never does).
    await expect(new Response(calls[0]?.init.body).arrayBuffer()).rejects.toThrow(/too large/);
    expect(sent).toBeLessThan(20);
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

  it("passes upstream errors through and answers 502 when PostHog is unreachable", async () => {
    const failing = upstream(() => new Response("nope", { status: 503 }));
    expect((await proxy(new Request(`${ORIGIN}/lens/e/`), failing.fetch)).status).toBe(503);

    const unreachable = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const response = await handleTelemetryProxy(new Request(`${ORIGIN}/lens/e/`), {
      ...hosts,
      clientIp: null,
      fetch: unreachable,
    });
    expect(response.status).toBe(502);
  });

  it("answers 404 for a path outside the proxy", async () => {
    const { fetch } = upstream();
    expect((await proxy(new Request(`${ORIGIN}/api/trpc`), fetch)).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
});
