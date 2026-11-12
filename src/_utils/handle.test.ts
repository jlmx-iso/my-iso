import { describe, expect, it } from "vitest";

import { HANDLE_PATTERN, normalizeHandle, publicProfileUrl, validateHandle } from "./handle";

describe("normalizeHandle", () => {
  it("strips a leading @, spaces and capitals", () => {
    expect(normalizeHandle("  @SarahChen ")).toBe("sarahchen");
    expect(normalizeHandle("@@marcus_r")).toBe("marcus_r");
    expect(normalizeHandle("")).toBe("");
  });
});

describe("validateHandle", () => {
  it("accepts lowercase letters, digits and underscores, 3 to 30 characters", () => {
    for (const handle of ["abc", "sarah_chen", "shooter_2", "a".repeat(30), "___", "123"]) {
      expect(validateHandle(handle)).toBeNull();
      expect(HANDLE_PATTERN.test(handle)).toBe(true);
    }
  });

  it("accepts what people type once normalised", () => {
    expect(validateHandle("@SarahChen")).toBeNull();
    expect(validateHandle("  sarahchen  ")).toBeNull();
  });

  it("treats an empty handle as valid: the field is optional", () => {
    expect(validateHandle("")).toBeNull();
    expect(validateHandle("   ")).toBeNull();
    expect(validateHandle("@")).toBeNull();
  });

  it("rejects handles that are too short or too long", () => {
    expect(validateHandle("ab")).toMatch(/at least 3/);
    expect(validateHandle("a".repeat(31))).toMatch(/at most 30/);
  });

  it("rejects anything outside the allowed characters", () => {
    for (const handle of ["sarah chen", "sarah-chen", "sarah.chen", "sarah/chen", "sarahé", "sarah@chen", "a?b=c"]) {
      expect(validateHandle(handle)).toMatch(/lowercase letters, numbers and underscores/);
    }
  });
});

describe("publicProfileUrl", () => {
  it("matches the route: no @ and no double slash", () => {
    expect(publicProfileUrl("https://myiso.app", "sarahchen")).toBe("https://myiso.app/photographer/sarahchen");
    expect(publicProfileUrl("https://myiso.app/", "@SarahChen")).toBe("https://myiso.app/photographer/sarahchen");
  });
});
