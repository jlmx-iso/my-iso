import { describe, expect, it } from "vitest";
import { ADMIN_ROLES, USER_ROLES, WAITLIST_APPROVED_CODE } from "./roles";

describe("USER_ROLES", () => {
  it("contains standard role", () => {
    expect(USER_ROLES.STANDARD).toBe("standard");
  });

  it("contains founding_member role", () => {
    expect(USER_ROLES.FOUNDING_MEMBER).toBe("founding_member");
  });

  it("contains founder role", () => {
    expect(USER_ROLES.FOUNDER).toBe("founder");
  });

  it("contains ambassador role", () => {
    expect(USER_ROLES.AMBASSADOR).toBe("ambassador");
  });

  it("has exactly 4 roles", () => {
    expect(Object.keys(USER_ROLES)).toHaveLength(4);
  });
});

describe("ADMIN_ROLES", () => {
  it("includes founder", () => {
    expect(ADMIN_ROLES).toContain("founder");
  });

  it("includes ambassador", () => {
    expect(ADMIN_ROLES).toContain("ambassador");
  });

  it("excludes standard", () => {
    expect(ADMIN_ROLES).not.toContain("standard");
  });

  it("excludes founding_member", () => {
    expect(ADMIN_ROLES).not.toContain("founding_member");
  });

  it("has exactly 2 roles", () => {
    expect(ADMIN_ROLES).toHaveLength(2);
  });
});

describe("WAITLIST_APPROVED_CODE", () => {
  it("equals WAITLIST_APPROVED", () => {
    expect(WAITLIST_APPROVED_CODE).toBe("WAITLIST_APPROVED");
  });
});
