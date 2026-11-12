import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  CSP_HEADER,
} from "./securityHeaders.js";

const options = {
  baseUrl: "https://myiso.app",
  posthogHost: "https://us.i.posthog.com",
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

  it("defaults to same-origin and forbids framing, plugins and base hijacking", () => {
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
  });

  it("allows what the app loads: PostHog, Cloudinary and Google images, its WebSocket", () => {
    expect(csp["script-src"]).toContain("https://us.i.posthog.com");
    expect(csp["connect-src"]).toContain("https://us.i.posthog.com");
    expect(csp["connect-src"]).toContain("wss://myiso.app");
    expect(csp["img-src"]).toEqual(
      expect.arrayContaining(["https://res.cloudinary.com", "https://lh3.googleusercontent.com"]),
    );
    expect(csp["style-src"]).toContain("'unsafe-inline'");
    expect(csp["form-action"]).toEqual(
      expect.arrayContaining(["https://accounts.google.com", "https://checkout.stripe.com"]),
    );
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

  it("adds eval and the dev WebSocket only in development", () => {
    const dev = directives(buildContentSecurityPolicy({ ...options, isDevelopment: true }));
    expect(dev["script-src"]).toContain("'unsafe-eval'");
    expect(dev["connect-src"]).toContain("ws:");
  });

  it("copes with missing or malformed configuration", () => {
    expect(() => buildContentSecurityPolicy()).not.toThrow();
    const policy = buildContentSecurityPolicy({ baseUrl: "not a url", posthogHost: "" });
    expect(policy).toContain("default-src 'self'");
    expect(policy).not.toContain("not a url");
  });
});

describe("buildSecurityHeaders", () => {
  const headers = new Map(buildSecurityHeaders(options).map(({ key, value }) => [key, value]));

  it("sets every required header", () => {
    expect(headers.get("Strict-Transport-Security")).toMatch(/max-age=\d{8,}; includeSubDomains/);
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Permissions-Policy")).toContain("geolocation=()");
    expect(headers.get(CSP_HEADER)).toBe(buildContentSecurityPolicy(options));
  });

  it("ships the policy under a real CSP header name", () => {
    expect(["Content-Security-Policy", "Content-Security-Policy-Report-Only"]).toContain(CSP_HEADER);
  });

  it("contains no header twice", () => {
    expect(headers.size).toBe(buildSecurityHeaders(options).length);
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
