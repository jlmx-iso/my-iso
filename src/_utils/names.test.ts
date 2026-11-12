import { describe, expect, it } from "vitest";

import { businessName, fullName } from "./names";

describe("fullName", () => {
  it("joins first and last name", () => {
    expect(fullName({ firstName: "Ada", lastName: "Okafor" })).toBe("Ada Okafor");
  });

  it("copes with a missing part and stray spaces", () => {
    expect(fullName({ firstName: " Ada ", lastName: "" })).toBe("Ada");
    expect(fullName({ firstName: null, lastName: "Okafor" })).toBe("Okafor");
  });

  it("falls back when there is no name at all", () => {
    expect(fullName({ firstName: "", lastName: "" })).toBe("ISO member");
    expect(fullName(null, "this photographer")).toBe("this photographer");
  });
});

describe("businessName", () => {
  const ada = { firstName: "Ada", lastName: "Okafor" };

  it("is the company when it says something the name does not", () => {
    expect(businessName(ada, " Golden Hour Studio ")).toBe("Golden Hour Studio");
  });

  it("is nothing when missing or just the person's name again", () => {
    expect(businessName(ada, "")).toBeNull();
    expect(businessName(ada, null)).toBeNull();
    expect(businessName(ada, "ada okafor")).toBeNull();
  });
});
