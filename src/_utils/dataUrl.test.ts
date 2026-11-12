import { describe, expect, it } from "vitest";

import { dataUrlToBase64 } from "./dataUrl";

describe("dataUrlToBase64", () => {
  it("returns the payload of a base64 data URL", () => {
    expect(dataUrlToBase64("data:image/png;base64,aGVsbG8=")).toBe("aGVsbG8=");
  });

  it("returns undefined when the reader has no result", () => {
    expect(dataUrlToBase64(null)).toBeUndefined();
  });

  it("returns undefined for a non-string result", () => {
    expect(dataUrlToBase64(new ArrayBuffer(4))).toBeUndefined();
  });

  it("returns undefined when there is no payload", () => {
    expect(dataUrlToBase64("data:image/png;base64,")).toBeUndefined();
    expect(dataUrlToBase64("not-a-data-url")).toBeUndefined();
  });
});
