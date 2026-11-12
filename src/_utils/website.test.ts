import { describe, expect, it } from "vitest";

import { parseOptionalWebsite } from "./website";

describe("parseOptionalWebsite", () => {
  it("treats empty input as 'no website'", () => {
    expect(parseOptionalWebsite("")).toEqual({ ok: true, value: null });
    expect(parseOptionalWebsite("   ")).toEqual({ ok: true, value: null });
    expect(parseOptionalWebsite(null)).toEqual({ ok: true, value: null });
    expect(parseOptionalWebsite(undefined)).toEqual({ ok: true, value: null });
  });

  it("accepts full URLs and adds https:// to bare domains", () => {
    expect(parseOptionalWebsite("https://sarahchen.photo/work")).toEqual({
      ok: true,
      value: "https://sarahchen.photo/work",
    });
    expect(parseOptionalWebsite(" sarahchen.photo ")).toEqual({
      ok: true,
      value: "https://sarahchen.photo/",
    });
  });

  it("rejects unsafe schemes, bare words and text with spaces", () => {
    expect(parseOptionalWebsite("javascript:alert(1)")).toEqual({ ok: false });
    expect(parseOptionalWebsite("mysite")).toEqual({ ok: false });
    expect(parseOptionalWebsite("my site.com")).toEqual({ ok: false });
  });
});
