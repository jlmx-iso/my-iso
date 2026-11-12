import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy } from "~/securityHeaders.js";

import {
  applyContentSecurityPolicy,
  createNonce,
  nextWithContentSecurityPolicy,
  NONCE_HEADER,
} from "./contentSecurityPolicy";

const NONCE = "AAECAwQFBgcICQoLDA0ODw==";
const options = { baseUrl: "https://myiso.app", mode: "enforce" } as const;

describe("createNonce", () => {
  it("is 128 random bits in base64, different every time", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => createNonce()));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(atob(nonce)).toHaveLength(16);
    }
  });

  it("is accepted by the policy builder", () => {
    expect(() => buildContentSecurityPolicy({ nonce: createNonce() })).not.toThrow();
  });
});

describe("applyContentSecurityPolicy", () => {
  it("hands the nonce and the policy to the page and returns the response header", () => {
    const requestHeaders = new Headers({ accept: "text/html" });
    const header = applyContentSecurityPolicy(requestHeaders, options, NONCE);

    expect(header).toEqual({
      key: "Content-Security-Policy",
      value: buildContentSecurityPolicy({ baseUrl: options.baseUrl, nonce: NONCE }),
    });
    expect(requestHeaders.get(NONCE_HEADER)).toBe(NONCE);
    // Next.js finds the nonce for its own scripts in this request header.
    expect(requestHeaders.get("content-security-policy")).toBe(header.value);
    expect(requestHeaders.get("accept")).toBe("text/html");
  });

  it("overwrites a nonce the client sent", () => {
    const requestHeaders = new Headers({ [NONCE_HEADER]: "chosen-by-the-client" });
    applyContentSecurityPolicy(requestHeaders, options, NONCE);
    expect(requestHeaders.get(NONCE_HEADER)).toBe(NONCE);
  });

  it("makes a fresh nonce when none is given", () => {
    const first = new Headers();
    const second = new Headers();
    applyContentSecurityPolicy(first, options);
    applyContentSecurityPolicy(second, options);
    expect(first.get(NONCE_HEADER)).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(first.get(NONCE_HEADER)).not.toBe(second.get(NONCE_HEADER));
    expect(first.get("content-security-policy")).toContain(`'nonce-${first.get(NONCE_HEADER)}'`);
  });

  it("uses the report-only header in report-only mode", () => {
    const header = applyContentSecurityPolicy(new Headers(), { ...options, mode: "report-only" }, NONCE);
    expect(header.key).toBe("Content-Security-Policy-Report-Only");
    expect(header.value).toContain(`'nonce-${NONCE}'`);
  });
});

describe("nextWithContentSecurityPolicy", () => {
  it("continues to the page with the nonce, and sets the policy on the response", () => {
    const request = new Request("https://myiso.app/about", { headers: { accept: "text/html" } });
    const response = nextWithContentSecurityPolicy(request, options, NONCE);

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("Content-Security-Policy")).toBe(
      buildContentSecurityPolicy({ baseUrl: options.baseUrl, nonce: NONCE }),
    );
    expect(response.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
    // How Next.js passes changed request headers on to the page.
    expect(response.headers.get(`x-middleware-request-${NONCE_HEADER}`)).toBe(NONCE);
    expect(response.headers.get("x-middleware-request-content-security-policy")).toContain(
      `'nonce-${NONCE}'`,
    );
    expect(response.headers.get("x-middleware-request-accept")).toBe("text/html");
  });

  it("only reports in report-only mode", () => {
    const request = new Request("https://myiso.app/");
    const response = nextWithContentSecurityPolicy(request, { ...options, mode: "report-only" });
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
    expect(response.headers.get("Content-Security-Policy-Report-Only")).toMatch(/'nonce-[^']+'/);
  });
});
