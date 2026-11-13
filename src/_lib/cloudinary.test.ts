import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cloudinaryClient } from "./cloudinary";

// Cloudinary is never called: `fetch` is replaced at the boundary and the
// signatures are checked against an independent SHA-1 of the documented
// string-to-sign (parameters sorted, joined with &, then the API secret).
const fetchMock = vi.fn<typeof fetch>();
const NOW_MS = Date.UTC(2030, 0, 1, 12, 0, 0, 400);
const TIMESTAMP = Math.round(NOW_MS / 1000);
const SECRET = "test-cloudinary-secret";

const sha1 = (value: string) => createHash("sha1").update(value).digest("hex");
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" }, status });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers({ now: NOW_MS, toFake: ["Date"] });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("upload", () => {
  const image = { base64: "AAAA", mime: "image/png" };

  it("posts the image as a signed upload converted to JPEG", async () => {
    const uploaded = {
      bytes: 3,
      created_at: "2030-01-01T12:00:00Z",
      format: "jpg",
      height: 1,
      public_id: "u1/profile/x",
      secure_url: "https://res.cloudinary.com/test-cloud/image/upload/v1/u1/profile/x.jpg",
      width: 1,
    };
    fetchMock.mockResolvedValue(jsonResponse(uploaded));

    await expect(cloudinaryClient.upload(image, "u1/profile")).resolves.toEqual({
      isErr: false,
      isOk: true,
      value: uploaded,
    });

    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(input).toBe("https://api.cloudinary.com/v1_1/test-cloud/image/upload");
    expect(init?.method).toBe("POST");
    const body = init?.body;
    if (!(body instanceof FormData)) throw new Error("the upload is not multipart form data");
    expect(Object.fromEntries(body.entries())).toEqual({
      api_key: "test-cloudinary-key",
      file: "data:image/png;base64,AAAA",
      folder: "u1/profile",
      format: "jpg",
      // Every signed parameter, sorted; the file and api_key are not signed.
      signature: sha1(`folder=u1/profile&format=jpg&timestamp=${TIMESTAMP}${SECRET}`),
      timestamp: String(TIMESTAMP),
    });
  });

  it("returns Cloudinary's message and status when the upload is refused", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: "File size too large" } }, 400));

    await expect(cloudinaryClient.upload(image, "f")).resolves.toEqual({
      error: { http_code: 400, message: "File size too large" },
      isErr: true,
      isOk: false,
    });
  });

  it("says the upload failed when the refusal carries no message", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 502));

    await expect(cloudinaryClient.upload(image, "f")).resolves.toMatchObject({
      error: { http_code: 502, message: "Upload failed" },
    });
  });

  it("answers 500 when the request itself fails", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    await expect(cloudinaryClient.upload(image, "f")).resolves.toMatchObject({
      error: { http_code: 500, message: "network down" },
    });

    fetchMock.mockRejectedValueOnce(42);
    await expect(cloudinaryClient.upload(image, "f")).resolves.toMatchObject({
      error: { http_code: 500, message: "Unknown error" },
    });
  });
});
