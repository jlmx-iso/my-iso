import { describe, expect, it } from "vitest";

import {
  HANDLE_MESSAGES,
  HANDLE_PATTERN,
  RESERVED_HANDLES,
  handleProblem,
  normalizeHandle,
  publicProfileUrl,
  refusedHandleMessage,
  validateHandle,
} from "./handle";

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

describe("handle messages", () => {
  it("names each problem in plain language", () => {
    expect(validateHandle("ab")).toBe(HANDLE_MESSAGES.too_short);
    expect(validateHandle("a".repeat(31))).toBe(HANDLE_MESSAGES.too_long);
    expect(validateHandle("sarah chen")).toBe(HANDLE_MESSAGES.invalid_characters);
    expect(validateHandle("admin")).toBe(HANDLE_MESSAGES.reserved);
    for (const message of Object.values(HANDLE_MESSAGES)) {
      expect(message).not.toMatch(/[[{]|regex|zod/i);
    }
  });

  it("blocks every reserved word, in any letter case and with an @", () => {
    for (const word of RESERVED_HANDLES) {
      // Reserved words shorter than the minimum fail on length first.
      expect(validateHandle(word)).not.toBeNull();
    }
    expect(validateHandle("@Admin")).toBe(HANDLE_MESSAGES.reserved);
    expect(handleProblem("support")).toBe("reserved");
    expect(validateHandle("adminphotos")).toBeNull();
  });

  it("checks length before characters before reserved words", () => {
    expect(handleProblem("a!")).toBe("too_short");
    expect(handleProblem("me")).toBe("too_short");
    expect(handleProblem("a-b")).toBe("invalid_characters");
  });
});

describe("refusedHandleMessage", () => {
  it("says a handle is taken on a conflict", () => {
    expect(refusedHandleMessage("sarahchen", { code: "CONFLICT", invalidFields: [] })).toBe(HANDLE_MESSAGES.taken);
  });

  it("explains a handle the server's validation refused", () => {
    expect(refusedHandleMessage("admin", { code: "BAD_REQUEST", invalidFields: ["handle"] })).toBe(
      HANDLE_MESSAGES.reserved,
    );
    // Refused for a reason the shared rule does not know about.
    expect(refusedHandleMessage("fine_name", { code: "BAD_REQUEST", invalidFields: ["handle"] })).toBe(
      HANDLE_MESSAGES.refused,
    );
  });

  it("stays out of failures that are not about the handle", () => {
    expect(refusedHandleMessage("fine_name", { code: "BAD_REQUEST", invalidFields: ["phone"] })).toBeNull();
    expect(refusedHandleMessage("fine_name", { code: undefined, invalidFields: [] })).toBeNull();
  });
});
