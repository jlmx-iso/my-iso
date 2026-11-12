import { describe, expect, it } from "vitest";

import { DEFAULT_SIGNED_IN_PATH, sanitizeCallbackUrl } from "./callbackUrl";

describe("sanitizeCallbackUrl", () => {
  it.each([
    "/app/events",
    "/app/messages?new=user_1",
    "/app/messages/abc123?x=1&y=2#latest",
    "/",
    "/app/search?q=https://example.com",
  ])("keeps the same-origin relative URL %s", (url) => {
    expect(sanitizeCallbackUrl(url)).toBe(url);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["an absolute URL", "https://evil.example/app"],
    ["an absolute URL without slashes", "https:evil.example"],
    ["a protocol-relative URL", "//evil.example/app"],
    ["a protocol-relative URL with extra slashes", "///evil.example"],
    ["a backslash protocol-relative URL", "/\\evil.example"],
    ["a backslash later in the path", "/app\\..\\evil"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:text/html,hi"],
    ["a relative path without a leading slash", "app/events"],
    ["a tab hidden in the slashes", "/\t/evil.example"],
    ["a newline hidden in the slashes", "/\n/evil.example"],
    ["leading whitespace", " /app/events"],
  ])("falls back for %s", (_label, url) => {
    expect(sanitizeCallbackUrl(url)).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("uses the given fallback", () => {
    expect(sanitizeCallbackUrl("//evil.example", "/app/profile")).toBe("/app/profile");
  });

  it("normalises dot segments instead of passing them through", () => {
    expect(sanitizeCallbackUrl("/app/../login")).toBe("/login");
  });
});
