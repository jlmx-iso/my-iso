import { describe, expect, it } from "vitest";

import {
  CONSENT_COOKIE,
  COUNTRY_HEADER,
  consentCapabilities,
  consentRequiresOptIn,
  OPT_IN_COUNTRIES,
  consentFromHeaders,
  parseConsentCookie,
  resolveConsent,
  serializeConsentCookie,
} from "~/_lib/consent";

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
    expect(parseConsentCookie(`garbage; ${CONSENT_COOKIE}=denied`)).toBe("denied");
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

describe("the analytics-only choice", () => {
  it("is read from the cookie and round-trips", () => {
    expect(parseConsentCookie(`${CONSENT_COOKIE}=analytics`)).toBe("analytics");
    expect(parseConsentCookie(serializeConsentCookie("analytics").split(";")[0])).toBe("analytics");
  });

  it("allows analytics and storage, but not session replay or person properties", () => {
    expect(consentCapabilities("analytics")).toEqual({
      capture: true,
      personProperties: false,
      sessionReplay: false,
      storage: true,
    });
  });
});

describe("consentRequiresOptIn", () => {
  it("is true for the EU and its outermost regions, the EEA, the UK and its dependencies, CH, CA and BR", () => {
    const expected = [
      "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU",
      "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
      "IS", "LI", "NO", "GB", "CH",
      "GF", "GP", "MQ", "RE", "YT", "MF", "AX", "GI", "JE", "GG", "IM", "CA", "BR",
    ];
    expect([...OPT_IN_COUNTRIES].sort()).toEqual([...expected].sort());
    for (const country of expected) expect(consentRequiresOptIn(country)).toBe(true);
  });

  it("is false elsewhere", () => {
    for (const country of ["US", "AU", "JP", "MX", "IN", "TR", "PR", "ZA"]) {
      expect(consentRequiresOptIn(country)).toBe(false);
    }
  });

  it("ignores case and surrounding space", () => {
    expect(consentRequiresOptIn(" de ")).toBe(true);
    expect(consentRequiresOptIn("gb")).toBe(true);
  });

  it("applies the strict rule when Cloudflare cannot place the visitor", () => {
    expect(consentRequiresOptIn("XX")).toBe(true);
    expect(consentRequiresOptIn("T1")).toBe(true);
  });

  it("applies the default rule when there is no country at all (no Worker in front)", () => {
    expect(consentRequiresOptIn(null)).toBe(false);
    expect(consentRequiresOptIn(undefined)).toBe(false);
    expect(consentRequiresOptIn("")).toBe(false);
  });
});

describe("resolveConsent in an opt-in region", () => {
  it("treats no choice as a refusal", () => {
    expect(resolveConsent({ cookie: null, globalPrivacyControl: false, optInRequired: true })).toBe(
      "denied",
    );
  });

  it("follows an explicit choice", () => {
    for (const cookie of ["granted", "analytics", "denied"] as const) {
      expect(resolveConsent({ cookie, globalPrivacyControl: false, optInRequired: true })).toBe(cookie);
    }
  });

  it("still lets Global Privacy Control win", () => {
    expect(
      resolveConsent({ cookie: "granted", globalPrivacyControl: true, optInRequired: true }),
    ).toBe("denied");
  });
});

describe("consentFromHeaders with a country", () => {
  it("denies by default for a visitor from an opt-in region", () => {
    expect(consentFromHeaders(new Headers({ [COUNTRY_HEADER]: "FR" }))).toBe("denied");
    expect(
      consentFromHeaders(new Headers({ cookie: `${CONSENT_COOKIE}=analytics`, [COUNTRY_HEADER]: "FR" })),
    ).toBe("analytics");
  });

  it("keeps the pseudonymous default elsewhere", () => {
    expect(consentFromHeaders(new Headers({ [COUNTRY_HEADER]: "US" }))).toBe("unknown");
  });
});
