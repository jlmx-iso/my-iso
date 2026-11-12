import { describe, expect, it } from "vitest";

import { handleProblem, normalizeHandle } from "~/_utils/handle";

import { handleInput, RESERVED_HANDLES } from "./handle";

describe("handleInput", () => {
  it("normalises exactly as the forms do (one shared function)", () => {
    for (const typed of ["  @Jane_Doe99 ", "@ann", "@@ann", "ANN", " ann "]) {
      const parsed = handleInput.safeParse(typed);
      const client = normalizeHandle(typed);
      // Same normalisation; and the server accepts exactly what the form's rules accept.
      if (parsed.success) expect(parsed.data).toBe(client);
      expect(parsed.success).toBe(handleProblem(client) === null);
    }
    expect(handleInput.safeParse("@@ann").success).toBe(false);
    expect(normalizeHandle("@@ann")).toBe("@ann");
  });

  it("lowercases, trims and drops a leading @", () => {
    expect(handleInput.parse("  @Jane_Doe99 ")).toBe("jane_doe99");
  });

  it("accepts 3 to 30 characters of a-z, 0-9 and underscore", () => {
    expect(handleInput.safeParse("abc").success).toBe(true);
    expect(handleInput.safeParse("a".repeat(30)).success).toBe(true);
    expect(handleInput.safeParse("ab").success).toBe(false);
    expect(handleInput.safeParse("a".repeat(31)).success).toBe(false);
  });

  it.each([
    "jane doe",
    "jane-doe",
    "jane.doe",
    "jane/doe",
    "../admin",
    "jané",
    "<script>",
    "jane?x=1",
    "@@jane",
    "",
  ])("rejects %j", (value) => {
    expect(handleInput.safeParse(value).success).toBe(false);
  });

  it("blocks reserved words in any letter case", () => {
    for (const word of ["admin", "Admin", "API", "support", "@login", "photographer"]) {
      expect(handleInput.safeParse(word).success).toBe(false);
    }
    expect(RESERVED_HANDLES.has("admin")).toBe(true);
  });

  it("does not block names that merely contain a reserved word", () => {
    expect(handleInput.parse("adminphotos")).toBe("adminphotos");
  });
});
