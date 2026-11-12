import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  contentSecurityPolicyHeader,
  CSP_MODES,
  CSP_REPORT_GROUP,
  CSP_REPORT_PATH,
  cspHeaderName,
  DEFAULT_CSP_MODE,
} from "./securityHeaders.js";

const NONCE = "AAECAwQFBgcICQoLDA0ODw==";

const options = {
  baseUrl: "https://myiso.app",
  nonce: NONCE,
};

function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split("; ").map((directive) => {
      const [name = "", ...sources] = directive.split(" ");
      return [name, sources];
    }),
  );
}

describe("buildContentSecurityPolicy", () => {
  const csp = directives(buildContentSecurityPolicy(options));

  it("defaults to same-origin and forbids framing, plugins, base hijacking and foreign forms", () => {
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["frame-src"]).toEqual(["'none'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["form-action"]).toEqual([
      "'self'",
      "https://accounts.google.com",
      "https://checkout.stripe.com",
      "https://billing.stripe.com",
    ]);
  });

  it("lets scripts run only with this response's nonce, and what they load", () => {
    expect(csp["script-src"]).toEqual(["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"]);
    expect(csp["script-src"]).not.toContain("'unsafe-inline'");
  });

  it("puts each nonce in its own policy", () => {
    const other = "ZmVkY2JhOTg3NjU0MzIxMA==";
    const policy = buildContentSecurityPolicy({ ...options, nonce: other });
    expect(policy).toContain(`'nonce-${other}'`);
    expect(policy).not.toContain(NONCE);
  });

  it("allows what the app loads: Cloudinary and Google images, its WebSocket, Mantine's styles", () => {
    expect(csp["connect-src"]).toEqual(["'self'", "wss://myiso.app"]);
    expect(csp["img-src"]).toEqual(
      expect.arrayContaining(["https://res.cloudinary.com", "https://lh3.googleusercontent.com"]),
    );
    // Style attributes cannot carry a nonce (see the builder's comment).
    expect(csp["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp["worker-src"]).toEqual(["'self'", "blob:"]);
  });

  it("never allows eval, wildcard sources or plain-http hosts in production", () => {
    const policy = buildContentSecurityPolicy(options);
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toMatch(/(^|[ ;])\*([ ;]|$)/);
    expect(policy).not.toContain("http://");
    expect(policy).not.toMatch(/ ws:( |;|$)/);
    for (const name of ["script-src", "connect-src", "img-src", "default-src"]) {
      expect(csp[name]).not.toContain("https:");
    }
  });

  it("names no third-party telemetry host: analytics go through this origin", () => {
    expect(buildContentSecurityPolicy(options)).not.toMatch(/posthog|sentry/i);
  });

  it("sends violation reports to the app's own endpoint", () => {
    expect(csp["report-uri"]).toEqual([CSP_REPORT_PATH]);
    expect(csp["report-to"]).toEqual([CSP_REPORT_GROUP]);
    const headers = new Map(buildSecurityHeaders().map(({ key, value }) => [key, value]));
    expect(headers.get("Reporting-Endpoints")).toBe(`${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`);
  });

  it("adds eval and the dev WebSocket only in development", () => {
    const dev = directives(buildContentSecurityPolicy({ ...options, isDevelopment: true }));
    expect(dev["script-src"]).toContain("'unsafe-eval'");
    expect(dev["script-src"]).toContain(`'nonce-${NONCE}'`);
    expect(dev["connect-src"]).toContain("ws:");
  });

  it("copes with a missing or malformed base URL", () => {
    expect(() => buildContentSecurityPolicy({ nonce: NONCE })).not.toThrow();
    const policy = buildContentSecurityPolicy({ baseUrl: "not a url", nonce: NONCE });
    expect(policy).toContain("default-src 'self'");
    expect(policy).not.toContain("not a url");
    expect(directives(policy)["connect-src"]).toEqual(["'self'"]);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["too short", "abc123"],
    ["a source-list breakout", `${NONCE}' 'unsafe-inline`],
    ["a directive breakout", `${NONCE}; script-src *`],
  ])("refuses a nonce that is %s", (_label, nonce) => {
    expect(() =>
      buildContentSecurityPolicy({ ...options, nonce: nonce as unknown as string }),
    ).toThrow(TypeError);
  });

  it("accepts URL-safe base64 nonces", () => {
    expect(buildContentSecurityPolicy({ ...options, nonce: "AAECAwQFBgcICQoLDA0ODw" })).toContain(
      "'nonce-AAECAwQFBgcICQoLDA0ODw'",
    );
  });
});

describe("contentSecurityPolicyHeader", () => {
  it("enforces the policy by default", () => {
    expect(DEFAULT_CSP_MODE).toBe("enforce");
    expect(CSP_MODES).toEqual(["enforce", "report-only"]);
  });

  it("enforces in enforce mode", () => {
    const header = contentSecurityPolicyHeader({ ...options, mode: "enforce" });
    expect(header.key).toBe("Content-Security-Policy");
    expect(header.value).toBe(buildContentSecurityPolicy(options));
  });

  it("only reports in report-only mode, with the same policy and reporting", () => {
    const header = contentSecurityPolicyHeader({ ...options, mode: "report-only" });
    expect(header.key).toBe("Content-Security-Policy-Report-Only");
    expect(header.value).toBe(buildContentSecurityPolicy(options));
    expect(directives(header.value)["report-uri"]).toEqual([CSP_REPORT_PATH]);
  });

  it("maps each mode to its header name", () => {
    expect(cspHeaderName("enforce")).toBe("Content-Security-Policy");
    expect(cspHeaderName("report-only")).toBe("Content-Security-Policy-Report-Only");
  });
});

describe("buildSecurityHeaders", () => {
  const headers = new Map(buildSecurityHeaders().map(({ key, value }) => [key, value]));

  it("sets every required header", () => {
    expect(headers.get("Strict-Transport-Security")).toMatch(/max-age=\d{8,}; includeSubDomains/);
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Permissions-Policy")).toContain("geolocation=()");
  });

  it("leaves the policy to the middleware: a static policy could not carry the nonce", () => {
    expect(headers.has("Content-Security-Policy")).toBe(false);
    expect(headers.has("Content-Security-Policy-Report-Only")).toBe(false);
  });

  it("contains no header twice", () => {
    expect(headers.size).toBe(buildSecurityHeaders().length);
  });

  it("is mirrored for static assets in public/_headers", () => {
    // Static files are served by Cloudflare without running the Worker.
    const staticHeaders = readFileSync(
      path.resolve(__dirname, "../public/_headers"),
      "utf8",
    );
    for (const key of [
      "X-Content-Type-Options",
      "Strict-Transport-Security",
      "Referrer-Policy",
      "X-Frame-Options",
    ]) {
      expect(staticHeaders).toContain(`  ${key}: ${headers.get(key)}`);
    }
  });
});

describe("nonPageHeaderRules", () => {
  it("gives API, Next.js internal and image paths a policy that allows nothing", async () => {
    const { nonPageHeaderRules, NON_PAGE_CONTENT_SECURITY_POLICY } = await import("./securityHeaders.js");
    const rules = nonPageHeaderRules();
    expect(rules.map((rule) => rule.source)).toEqual(["/api/:path*", "/_next/:path*", "/img/:path*"]);
    for (const rule of rules) {
      expect(rule.headers).toEqual([{ key: "Content-Security-Policy", value: NON_PAGE_CONTENT_SECURITY_POLICY }]);
    }
    expect(NON_PAGE_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(NON_PAGE_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
  });
});
