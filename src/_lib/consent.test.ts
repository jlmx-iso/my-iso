import { describe, expect, it } from "vitest";

import {
  CONSENT_COOKIE,
  consentCapabilities,
  consentFromHeaders,
  parseConsentCookie,
  resolveConsent,
  serializeConsentCookie,
} from "./consent";

describe("parseConsentCookie", () => {
  it("returns null without a cookie header or without the cookie", () => {
    expect(parseConsentCookie(null)).toBeNull();
    expect(parseConsentCookie("")).toBeNull();
    expect(parseConsentCookie("theme=dark; session=abc")).toBeNull();
  });

  it("reads the choice among other cookies", () => {
    expect(parseConsentCookie(`a=1; ${CONSENT_COOKIE}=granted; b=2`)).toBe("granted");
    expect(parseConsentCookie(`${CONSENT_COOKIE}=denied`)).toBe("denied");
  });

  it("ignores values it does not know and look-alike names", () => {
    expect(parseConsentCookie(`${CONSENT_COOKIE}=yes`)).toBeNull();
    expect(parseConsentCookie(`x${CONSENT_COOKIE}=granted`)).toBeNull();
    expect(parseConsentCookie(`${CONSENT_COOKIE}x=granted`)).toBeNull();
  });
});

describe("resolveConsent", () => {
  it("is unknown until a choice is made", () => {
    expect(resolveConsent({ cookie: null, globalPrivacyControl: false })).toBe("unknown");
  });

  it("follows the cookie", () => {
    expect(resolveConsent({ cookie: "granted", globalPrivacyControl: false })).toBe("granted");
    expect(resolveConsent({ cookie: "denied", globalPrivacyControl: false })).toBe("denied");
  });

  it("treats Global Privacy Control as a refusal, even over a granted cookie", () => {
    expect(resolveConsent({ cookie: null, globalPrivacyControl: true })).toBe("denied");
    expect(resolveConsent({ cookie: "granted", globalPrivacyControl: true })).toBe("denied");
  });
});

describe("consentCapabilities", () => {
  it("unknown allows analytics but not replay, person properties or browser storage", () => {
    expect(consentCapabilities("unknown")).toEqual({
      capture: true,
      personProperties: false,
      sessionReplay: false,
      storage: false,
    });
  });

  it("granted allows everything", () => {
    expect(consentCapabilities("granted")).toEqual({
      capture: true,
      personProperties: true,
      sessionReplay: true,
      storage: true,
    });
  });

  it("denied allows nothing", () => {
    expect(consentCapabilities("denied")).toEqual({
      capture: false,
      personProperties: false,
      sessionReplay: false,
      storage: false,
    });
  });
});

describe("consentFromHeaders", () => {
  it("reads the cookie", () => {
    expect(consentFromHeaders(new Headers({ cookie: `${CONSENT_COOKIE}=granted` }))).toBe(
      "granted",
    );
    expect(consentFromHeaders(new Headers())).toBe("unknown");
  });

  it("honours Sec-GPC: 1 and nothing else in that header", () => {
    expect(consentFromHeaders(new Headers({ "sec-gpc": "1" }))).toBe("denied");
    expect(
      consentFromHeaders(new Headers({ cookie: `${CONSENT_COOKIE}=granted`, "sec-gpc": "1" })),
    ).toBe("denied");
    expect(consentFromHeaders(new Headers({ "sec-gpc": "0" }))).toBe("unknown");
  });
});

describe("serializeConsentCookie", () => {
  it("round-trips an explicit choice", () => {
    for (const state of ["granted", "denied"] as const) {
      const cookie = serializeConsentCookie(state);
      expect(parseConsentCookie(cookie.split(";")[0])).toBe(state);
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).not.toContain("HttpOnly");
    }
  });

  it("clears the cookie for unknown", () => {
    expect(serializeConsentCookie("unknown")).toContain("Max-Age=0");
  });

  it("adds Secure on request", () => {
    expect(serializeConsentCookie("granted", { secure: true })).toContain("Secure");
    expect(serializeConsentCookie("granted")).not.toContain("Secure");
  });
});
