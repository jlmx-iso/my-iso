import { afterEach, describe, expect, it } from "vitest";

import { getClientIp, normalizeIp } from "./clientIp";

const cloudflareSymbol = Symbol.for("__cloudflare-context__");
const globals = globalThis as Record<symbol, unknown>;

afterEach(() => {
  delete globals[cloudflareSymbol];
});

describe("normalizeIp", () => {
  it("returns IPv4 addresses unchanged", () => {
    expect(normalizeIp(" 203.0.113.7 ")).toBe("203.0.113.7");
  });

  it("unwraps IPv4-mapped IPv6", () => {
    expect(normalizeIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("collapses IPv6 addresses to their /64", () => {
    expect(normalizeIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(normalizeIp("2001:0DB8:0001:0002::1")).toBe("2001:db8:1:2::/64");
    // Same subscriber, different interface id: same bucket.
    expect(normalizeIp("2001:db8:1:2::1")).toBe(normalizeIp("2001:db8:1:2:ffff::9"));
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(normalizeIp("::1")).toBe("0:0:0:0::/64");
  });
});

describe("getClientIp", () => {
  it("uses CF-Connecting-IP when present", () => {
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.7",
      "x-forwarded-for": "198.51.100.1",
    });
    expect(getClientIp(headers)).toBe("203.0.113.7");
  });

  it("never trusts X-Forwarded-For or X-Real-IP on Cloudflare", () => {
    globals[cloudflareSymbol] = {};
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.1",
      "x-real-ip": "198.51.100.2",
    });
    expect(getClientIp(headers)).toBe("unknown");
  });

  it("falls back to proxy headers off Cloudflare (local development)", () => {
    expect(getClientIp(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe(
      "198.51.100.1",
    );
    expect(getClientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(getClientIp(new Headers())).toBe("local");
  });
});
