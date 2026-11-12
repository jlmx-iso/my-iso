import { describe, expect, it } from "vitest";

import {
  isOwnCloudinaryUrl,
  MAX_IMAGE_BYTES,
  ownImageUrlInput,
  parseBase64Image,
  requireValidImage,
  sniffImageType,
  websiteUrlInput,
} from "./image";

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00];

/** Base64 of `head` followed by zero bytes up to `totalBytes`. */
function base64Of(head: number[], totalBytes = head.length): string {
  const bytes = Buffer.alloc(totalBytes);
  Buffer.from(head).copy(bytes);
  return bytes.toString("base64");
}

describe("sniffImageType", () => {
  it("recognises JPEG, PNG and WebP by their leading bytes", () => {
    expect(sniffImageType(Uint8Array.from(JPEG))).toBe("image/jpeg");
    expect(sniffImageType(Uint8Array.from(PNG))).toBe("image/png");
    expect(sniffImageType(Uint8Array.from(WEBP))).toBe("image/webp");
  });

  it("rejects everything else", () => {
    expect(sniffImageType(Uint8Array.from(GIF))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("RIFFxxxxWAVE"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("parseBase64Image", () => {
  it("accepts a valid image and reports its detected type and size", () => {
    const result = parseBase64Image(base64Of(PNG, 1000));
    expect(result).toMatchObject({ image: { byteLength: 1000, mime: "image/png" }, ok: true });
  });

  it("accepts a data URL and ignores the type it claims", () => {
    const result = parseBase64Image(`data:image/png;base64,${base64Of(JPEG, 64)}`);
    expect(result).toMatchObject({ image: { byteLength: 64, mime: "image/jpeg" }, ok: true });
    expect(result.ok && result.image.base64.startsWith("data:")).toBe(false);
  });

  it("accepts an image of exactly the maximum size", () => {
    expect(parseBase64Image(base64Of(JPEG, MAX_IMAGE_BYTES))).toMatchObject({ ok: true });
  });

  it("rejects an image one byte over the maximum", () => {
    expect(parseBase64Image(base64Of(JPEG, MAX_IMAGE_BYTES + 1))).toEqual({
      ok: false,
      reason: "too-large",
    });
  });

  it("rejects files that are not JPEG, PNG or WebP", () => {
    expect(parseBase64Image(base64Of(GIF, 64))).toEqual({ ok: false, reason: "unsupported-type" });
    const html = Buffer.from("<html><script>alert(1)</script></html>").toString("base64");
    expect(parseBase64Image(html)).toEqual({ ok: false, reason: "unsupported-type" });
    // Claiming to be an image does not help.
    expect(parseBase64Image(`data:image/jpeg;base64,${html}`)).toEqual({
      ok: false,
      reason: "unsupported-type",
    });
  });

  it("rejects input that is not base64, including URLs", () => {
    expect(parseBase64Image("https://evil.example/a.jpg")).toEqual({ ok: false, reason: "not-base64" });
    expect(parseBase64Image("not base64!!")).toEqual({ ok: false, reason: "not-base64" });
    expect(parseBase64Image("abc")).toEqual({ ok: false, reason: "not-base64" });
    expect(parseBase64Image("")).toEqual({ ok: false, reason: "empty" });
    expect(parseBase64Image("data:image/png;base64,")).toEqual({ ok: false, reason: "empty" });
  });
});

describe("requireValidImage", () => {
  it("maps rejections to tRPC errors", () => {
    expect(() => requireValidImage(base64Of(GIF, 64))).toThrowError(
      expect.objectContaining({ code: "BAD_REQUEST" }) as Error,
    );
    expect(() => requireValidImage(base64Of(JPEG, MAX_IMAGE_BYTES + 1))).toThrowError(
      expect.objectContaining({ code: "PAYLOAD_TOO_LARGE" }) as Error,
    );
  });
});

describe("isOwnCloudinaryUrl", () => {
  const ok = "https://res.cloudinary.com/test-cloud/image/upload/v1/u1/profile/a.jpg";

  it("accepts images on the app's own cloud", () => {
    expect(isOwnCloudinaryUrl(ok, "test-cloud")).toBe(true);
    // Defaults to the configured cloud name.
    expect(isOwnCloudinaryUrl(ok)).toBe(true);
    expect(ownImageUrlInput.safeParse(ok).success).toBe(true);
  });

  it.each([
    ["another Cloudinary cloud", "https://res.cloudinary.com/attacker/image/upload/a.jpg"],
    ["a prefix of the cloud name", "https://res.cloudinary.com/test-cloud-evil/image/upload/a.jpg"],
    ["another host", "https://evil.example/test-cloud/image/upload/a.jpg"],
    ["a look-alike host", "https://res.cloudinary.com.evil.example/test-cloud/image/upload/a.jpg"],
    ["credentials in the URL", "https://res.cloudinary.com@evil.example/test-cloud/image/upload/a.jpg"],
    ["plain http", "http://res.cloudinary.com/test-cloud/image/upload/a.jpg"],
    ["a non-default port", "https://res.cloudinary.com:8443/test-cloud/image/upload/a.jpg"],
    ["a non-image resource", "https://res.cloudinary.com/test-cloud/raw/upload/a.html"],
    ["an internal address", "http://169.254.169.254/latest/meta-data/"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:image/png;base64,AAAA"],
    ["a relative path", "/api/trpc/user.getMe"],
    ["an empty string", ""],
  ])("rejects %s", (_label, url) => {
    expect(isOwnCloudinaryUrl(url, "test-cloud")).toBe(false);
    expect(ownImageUrlInput.safeParse(url).success).toBe(false);
  });

  it("rejects everything when no cloud name is configured", () => {
    expect(isOwnCloudinaryUrl("https://res.cloudinary.com//image/upload/a.jpg", "")).toBe(false);
  });
});

describe("websiteUrlInput", () => {
  it("accepts http(s) URLs", () => {
    expect(websiteUrlInput.parse(" https://janedoe.photo/work ")).toBe("https://janedoe.photo/work");
    expect(websiteUrlInput.safeParse("http://example.com").success).toBe(true);
  });

  it.each(["javascript:alert(1)", "data:text/html,<script>", "ftp://example.com", "example.com", "https://", "//evil.example"])(
    "rejects %s",
    (value) => {
      expect(websiteUrlInput.safeParse(value).success).toBe(false);
    },
  );
});
