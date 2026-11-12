import { describe, expect, it } from "vitest";

import { requestCountry, withCountryHeader } from "./country";
import { COUNTRY_HEADER } from "../_lib/consent";


const withCf = (cf: unknown, init?: RequestInit) =>
  Object.assign(new Request("https://myiso.app/app", init), { cf }) as Request & {
    cf?: { country?: unknown } | null;
  };

describe("requestCountry", () => {
  it("reads Cloudflare's country", () => {
    expect(requestCountry(withCf({ country: "DE" }))).toBe("DE");
    expect(requestCountry(withCf({ country: "us" }))).toBe("US");
    expect(requestCountry(withCf({ country: "T1" }))).toBe("T1");
  });

  it("is null without a usable country", () => {
    expect(requestCountry(withCf(undefined))).toBeNull();
    expect(requestCountry(withCf(null))).toBeNull();
    expect(requestCountry(withCf({}))).toBeNull();
    expect(requestCountry(withCf({ country: 49 }))).toBeNull();
    expect(requestCountry(withCf({ country: "DEU" }))).toBeNull();
    expect(requestCountry(withCf({ country: "D;" }))).toBeNull();
  });
});

describe("withCountryHeader", () => {
  it("sets the header from Cloudflare's country", () => {
    const request = withCountryHeader(new Request("https://myiso.app/"), "FR");
    expect(request.headers.get(COUNTRY_HEADER)).toBe("FR");
  });

  it("replaces a value the client sent", () => {
    const sent = new Request("https://myiso.app/", { headers: { [COUNTRY_HEADER]: "US" } });
    expect(withCountryHeader(sent, "DE").headers.get(COUNTRY_HEADER)).toBe("DE");
  });

  it("drops a value the client sent when Cloudflare gave none", () => {
    const sent = new Request("https://myiso.app/", { headers: { [COUNTRY_HEADER]: "US" } });
    expect(withCountryHeader(sent, null).headers.has(COUNTRY_HEADER)).toBe(false);
  });

  it("returns the same request when there is nothing to change", () => {
    const request = new Request("https://myiso.app/");
    expect(withCountryHeader(request, null)).toBe(request);
  });

  it("keeps the method, other headers and the body", async () => {
    const request = new Request("https://myiso.app/lens/e/", {
      body: "payload",
      headers: { "content-type": "text/plain", cookie: "a=1" },
      method: "POST",
    });
    const forwarded = withCountryHeader(request, "GB");
    expect(forwarded.method).toBe("POST");
    expect(forwarded.headers.get("cookie")).toBe("a=1");
    expect(await forwarded.text()).toBe("payload");
  });
});
