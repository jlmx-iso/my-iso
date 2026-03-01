import { describe, expect, it } from "vitest";
import {
  instagramUrl,
  isValidInstagramHandle,
  normalizeInstagramHandle,
} from "./instagram";

describe("normalizeInstagramHandle", () => {
  it("strips leading @", () => {
    expect(normalizeInstagramHandle("@myhandle")).toBe("myhandle");
  });

  it("strips full https URL", () => {
    expect(normalizeInstagramHandle("https://instagram.com/myhandle")).toBe("myhandle");
  });

  it("strips www URL", () => {
    expect(normalizeInstagramHandle("https://www.instagram.com/myhandle")).toBe("myhandle");
  });

  it("strips trailing slash", () => {
    expect(normalizeInstagramHandle("myhandle/")).toBe("myhandle");
  });

  it("strips URL with trailing slash", () => {
    expect(normalizeInstagramHandle("https://instagram.com/myhandle/")).toBe("myhandle");
  });

  it("passes through a plain handle unchanged", () => {
    expect(normalizeInstagramHandle("myhandle")).toBe("myhandle");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeInstagramHandle("  myhandle  ")).toBe("myhandle");
  });

  it("handles http (non-https) URL", () => {
    expect(normalizeInstagramHandle("http://instagram.com/myhandle")).toBe("myhandle");
  });
});

describe("isValidInstagramHandle", () => {
  it("accepts a simple handle", () => {
    expect(isValidInstagramHandle("myhandle")).toBe(true);
  });

  it("accepts handles with dots and underscores", () => {
    expect(isValidInstagramHandle("my.handle_123")).toBe(true);
  });

  it("accepts handles with leading @", () => {
    expect(isValidInstagramHandle("@myhandle")).toBe(true);
  });

  it("rejects handles over 30 characters", () => {
    expect(isValidInstagramHandle("a".repeat(31))).toBe(false);
  });

  it("accepts handles of exactly 30 characters", () => {
    expect(isValidInstagramHandle("a".repeat(30))).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidInstagramHandle("")).toBe(false);
  });

  it("rejects handles with spaces", () => {
    expect(isValidInstagramHandle("my handle")).toBe(false);
  });

  it("accepts a full Instagram URL (after normalization)", () => {
    expect(isValidInstagramHandle("https://instagram.com/myhandle")).toBe(true);
  });
});

describe("instagramUrl", () => {
  it("constructs URL from bare handle", () => {
    expect(instagramUrl("myhandle")).toBe("https://instagram.com/myhandle");
  });

  it("passes through valid instagram.com URL", () => {
    const url = "https://instagram.com/myhandle";
    expect(instagramUrl(url)).toBe(url);
  });

  it("passes through www.instagram.com URL", () => {
    const url = "https://www.instagram.com/myhandle";
    expect(instagramUrl(url)).toBe(url);
  });

  it("returns null for non-instagram http URLs", () => {
    expect(instagramUrl("https://example.com/myhandle")).toBeNull();
  });
});
